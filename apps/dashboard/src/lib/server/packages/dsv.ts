// DSV (domestic parcels, formerly DB Schenker): the public tracking that dsv.com/mydsv/tracking-public
// uses (no account). A request without proof of work is answered 429 with a Captcha-Puzzle header;
// the site's own page then solves it (in a web worker) and repeats the request with Captcha-Solution.
// This does the same: the puzzle is a comma-separated list of JWTs whose payload carries 40-byte
// work items; a solution is the first 8-byte little-endian nonce for which SHA-256(SHA-256(first 32
// puzzle bytes + nonce)), read as a little-endian number, is below byte14 * 2^(8 * (byte13 - 3)).
// About 13 000 hashes per puzzle at the observed difficulty (13 = 33, 14 = 5), a few per request.
// Parcels are found by their waybill number (the consumer's 12-digit tracking code).
import { createHash } from 'node:crypto';
import type { PackageEvent, PackageState, PackageTracking } from '$lib/types';
import { NotFoundError } from './errors';

const BASE = 'https://www.dsv.com/nges-portal/api/public/tracking-public';
/** Stops a changed puzzle format from spinning forever (expected: about 13 000). */
const MAX_TRIES = 5_000_000;

interface DsvEvent {
	code: string | null;
	date: string | null;
	location: { name: string | null } | null;
	comment: string | null;
	reasons: { description?: string | null }[] | null;
}

interface DsvShipment {
	events: DsvEvent[] | null;
	deliveryDate: { estimated: string | null; agreed: string | null } | null;
	/** BOOKED, TRANSPORTATION, DISPATCHING_CENTER, IN_DELIVERY, DELIVERED */
	progressBar: { activeStep: string | null } | null;
	location: { deliverTo: { city: string | null; postCode: string | null } | null } | null;
}

/** Captcha-Puzzle header -> Captcha-Solution header. */
export function solvePuzzle(header: string): string {
	const solutions = Buffer.from(header, 'base64')
		.toString()
		.split(',')
		.map((jwt) => {
			const { puzzle } = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString()) as { puzzle: string };
			const bytes = Buffer.from(puzzle, 'base64');
			// Read as signed bytes, as the site's solver does (Int8Array).
			const target = BigInt(bytes.readInt8(14)) * 2n ** BigInt(8 * (bytes.readInt8(13) - 3));
			const input = Buffer.alloc(40);
			bytes.copy(input, 0, 0, 32);
			for (let n = 0; n < MAX_TRIES; n++) {
				input.writeBigUInt64LE(BigInt(n), 32);
				const hash = createHash('sha256').update(createHash('sha256').update(input).digest()).digest();
				if (BigInt(`0x${Buffer.from(hash).reverse().toString('hex')}`) < target) {
					return { jwt, solution: input.subarray(32).toString('base64') };
				}
			}
			throw new Error('DSV: proof of work not found');
		});
	return Buffer.from(JSON.stringify(solutions)).toString('base64');
}

/** GET with the proof of work when asked for; null on 404. */
async function get<T>(path: string): Promise<T | null> {
	const headers: Record<string, string> = { accept: 'application/json', 'x-version': '5' };
	let response = await fetch(`${BASE}${path}`, { headers, signal: AbortSignal.timeout(15_000) });
	const puzzle = response.status === 429 ? response.headers.get('captcha-puzzle') : null;
	if (puzzle) {
		response = await fetch(`${BASE}${path}`, { headers: { ...headers, 'captcha-solution': solvePuzzle(puzzle) }, signal: AbortSignal.timeout(15_000) });
	}
	if (response.status === 404) return null;
	if (!response.ok) throw new Error(`DSV: HTTP ${response.status}`);
	return (await response.json()) as T;
}

/** From the progress bar, with the latest event's text for pickup points and problems. */
function stateOf(s: DsvShipment, latest: DsvEvent | undefined): PackageState {
	const text = [latest?.code, latest?.comment, ...(latest?.reasons ?? []).map((r) => r.description)].filter(Boolean).join(' ');
	if (/return|damage|not delivered|fail|refus|lost/i.test(text)) return 'exception';
	const step = s.progressBar?.activeStep ?? '';
	if (step === 'DELIVERED') return 'delivered';
	// Not "picked up" / "collected": that is DSV collecting it from the sender.
	if (/pick-?up point|ready for (pick-?up|collection)|available for (pick-?up|collection)|parcel ?(shop|locker|point)|noudettavissa/i.test(text)) return 'pickup';
	if (step === 'TRANSPORTATION' || step === 'DISPATCHING_CENTER') return 'transit';
	if (step === 'BOOKED') return 'info';
	return s.events?.length ? 'transit' : 'unknown';
}

export async function trackDsv(code: string): Promise<PackageTracking> {
	const query = encodeURIComponent(code);
	const found =
		(await get<{ result: { id: string; transportMode: string }[] }>(`/shipments?query=${query}&referenceType=WaybillNo`)) ??
		(await get<{ result: { id: string; transportMode: string }[] }>(`/shipments?query=${query}`));
	const hit = found?.result?.[0];
	if (!hit) throw new NotFoundError();
	if (hit.transportMode !== 'LAND') throw new Error(`DSV: ${hit.transportMode.toLowerCase()} shipments are not supported`);
	const s = await get<DsvShipment>(`/shipments/land/${encodeURIComponent(hit.id)}`);
	if (!s) throw new NotFoundError();

	const raw = [...(s.events ?? [])].sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
	const events: PackageEvent[] = raw.map((e) => ({
		time: e.date,
		description: [e.comment || e.code || 'Event', ...(e.reasons ?? []).map((r) => r.description).filter(Boolean)].join(': '),
		location: e.location?.name || null
	}));
	const state = stateOf(s, raw[0]);
	return {
		state,
		summary: events[0]?.description ?? null,
		events,
		eta: state === 'delivered' ? null : (s.deliveryDate?.agreed ?? s.deliveryDate?.estimated ?? null),
		// The public answer has no pickup point details; the latest event's place is the best there is.
		pickup: state === 'pickup' ? { name: raw[0]?.location?.name || s.location?.deliverTo?.city || 'Pickup point', address: null, until: null } : null
	};
}
