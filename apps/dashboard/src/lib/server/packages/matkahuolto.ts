// Matkahuolto: the public tracking that matkahuolto.fi/seuranta uses (no account):
// GET wwwservice.matkahuolto.fi/search/trackingInfo?language=fi&parcelNumber=<code>, answering
// {"notFound": true} for unknown codes. Its documented API (extservices.matkahuolto.fi, event codes in
// MHTracking_FinV1.3.pdf) needs a business contract, so the state is read from the events' standard
// Finnish texts, which follow that document's event list ("Noudettavissa", "Luovutettu", …).
import type { PackageEvent, PackageState, PackageTracking } from '$lib/types';
import { NotFoundError } from './errors';

interface MhEvent {
	date?: string | null;
	time?: string | null;
	place?: string | null;
	officeCode?: string | null;
	description?: string | null;
}

interface MhTracking {
	notFound?: boolean;
	parcelNumber?: string | null;
	/** Pickup deadline while the parcel waits at a pickup point. */
	storedUntil?: string | null;
	deliveryDescription?: string | null;
	trackingEvents?: MhEvent[] | null;
}

/**
 * "11.10.2026" or "2026-10-11" with "14:35", "14.35" or "14:35:10" → the carrier's local wall time
 * ("YYYY-MM-DDTHH:MM:SS", Finnish time), which the card shows as is; null when unrecognised.
 */
export function wallTime(date: string | null | undefined, time: string | null | undefined): string | null {
	const d = date?.trim() ?? '';
	const dm = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(d) ?? /^(\d{4})-(\d{2})-(\d{2})/.exec(d);
	if (!dm) return null;
	const [y, m, day] = d.includes('-') ? [dm[1], dm[2], dm[3]] : [dm[3], dm[2], dm[1]];
	const tm = /^(\d{1,2})[:.](\d{2})(?:[:.](\d{2}))?/.exec(time?.trim() ?? '');
	const hms = tm ? `${tm[1].padStart(2, '0')}:${tm[2]}:${tm[3] ?? '00'}` : '00:00:00';
	return `${y}-${m.padStart(2, '0')}-${day.padStart(2, '0')}T${hms}`;
}

/** From the latest event's standard text (event list in MHTracking_FinV1.3.pdf), newest first. */
export function stateOf(events: MhEvent[], storedUntil: string | null | undefined): PackageState {
	const texts = events.map((e) => (e.description ?? '').toLowerCase());
	const latest = texts[0] ?? '';
	// 60 Luovutettu, 61 Luovutettu valtakirjalla; not 62 "Luovutus peruutettu".
	if (/^luovutettu/.test(latest)) return 'delivered';
	// 70 Palautettu noutamattomana, 97 Jakelu epäonnistunut, lost parcels.
	if (/palautettu|palautetaan|epäonnistu|kadonnut/.test(latest)) return 'exception';
	// 48 Saapunut pakettipisteeseen, 50 Noudettavissa, 55-57 Ilmoitettu.
	if (/noudettavissa|ilmoitettu|saapunut pakettipisteeseen/.test(latest) || storedUntil) return 'pickup';
	// 45 Lastattu jakelukuormaan.
	if (/jakelukuorma|jakelussa|kuljettajalla/.test(latest)) return 'out';
	// 02 Sähköinen ennakkotieto vastaanotettu: only the sender's details so far.
	if (/ennakkotieto/.test(latest) && texts.length === 1) return 'info';
	return events.length ? 'transit' : 'unknown';
}

export async function trackMatkahuolto(code: string): Promise<PackageTracking> {
	const url = new URL('https://wwwservice.matkahuolto.fi/search/trackingInfo');
	url.search = new URLSearchParams({ language: 'fi', parcelNumber: code }).toString();
	const response = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(15_000) });
	if (!response.ok) throw new Error(`Matkahuolto: HTTP ${response.status}`);
	const body = (await response.json()) as MhTracking;
	const raw = body.trackingEvents ?? [];
	if (body.notFound || raw.length === 0) throw new NotFoundError();

	const events: PackageEvent[] = raw
		.map((e) => {
			const time = wallTime(e.date, e.time);
			// An unrecognised date stays visible in the text rather than being dropped.
			const when = time ? '' : [e.date, e.time].filter(Boolean).join(' ');
			return { time, description: [when, e.description || 'Event'].filter(Boolean).join(' '), location: e.place || null };
		})
		.sort((a, b) => (b.time ?? '').localeCompare(a.time ?? ''));
	const state = stateOf(raw, body.storedUntil);
	const latest = raw[0];
	return {
		state,
		summary: latest?.description ?? null,
		events,
		eta: null,
		// The public answer names only the pickup point's town (event place) and the deadline.
		pickup: state === 'pickup' && latest?.place ? { name: latest.place, address: null, until: body.storedUntil ?? null } : null
	};
}
