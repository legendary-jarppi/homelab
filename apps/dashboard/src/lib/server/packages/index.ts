// Tracked packages: a JSON file on the dashboard's volume (PACKAGES_FILE), refreshed from the
// carriers while someone is looking at the dashboard, and every few minutes when notifications are
// set up (a package becoming ready for pickup is sent through apps/notify), never more often than
// each carrier allows.
// Link-only carriers (DHL) are never checked; their packages just link to the carrier's page.
// Packages leave the card for the archive (same file, `archivedAt` set, no longer checked) when
// archived by hand, two days after delivery, or when a link-only package's time is up.
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { config } from '$lib/server/config';
import { CARRIERS, carrierName, detectCarrier, LINK_ONLY, linkOnlyUntil, normalizeCode } from '$lib/packages';
import { dayOf } from '$lib/dates';
import type { Carrier, PackageTracking, PackagesData, TrackedPackage } from '$lib/types';
import { notify, notifyConfigured } from '$lib/server/notify';
import { NotFoundError } from './errors';
import { trackDsv } from './dsv';
import { trackMatkahuolto } from './matkahuolto';
import { trackPosti } from './posti';
import { trackUps } from './ups';

const TRACKERS: Partial<Record<Carrier, { track: (code: string) => Promise<PackageTracking>; refreshMs: number }>> = {
	posti: { track: trackPosti, refreshMs: 20 * 60_000 },
	matkahuolto: { track: trackMatkahuolto, refreshMs: 20 * 60_000 },
	ups: { track: trackUps, refreshMs: 20 * 60_000 },
	dsv: { track: trackDsv, refreshMs: 20 * 60_000 }
};
/** Failed checks (including "not found yet") are retried less eagerly. */
const RETRY_MS = 30 * 60_000;
/** Delivered packages stay on the card this long, then move to the archive. */
const KEEP_DELIVERED_MS = 2 * 86_400_000;
/** On the card (not archived). */
const MAX_PACKAGES = 30;
/** The oldest archived packages are dropped beyond this. */
const MAX_ARCHIVED = 100;

export class PackageInputError extends Error {}

let packages: TrackedPackage[] | null = null;
/** Serialises file writes and refreshes. */
let queue: Promise<unknown> = Promise.resolve();
const serial = <T>(task: () => Promise<T>): Promise<T> => {
	const run = queue.then(task, task);
	queue = run.catch(() => {});
	return run;
};

async function load(): Promise<TrackedPackage[]> {
	if (packages) return packages;
	try {
		packages = (JSON.parse(await readFile(config.packagesFile, 'utf8')) as TrackedPackage[]).map((p) => ({
			...p,
			// Files written before the archive existed.
			archivedAt: p.archivedAt ?? null,
			restoredAt: p.restoredAt ?? null
		}));
	} catch (e) {
		if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
		packages = [];
	}
	return packages;
}

const active = (list: TrackedPackage[]) => list.filter((p) => p.archivedAt === null);
const archivedNewestFirst = (list: TrackedPackage[]) =>
	list.filter((p) => p.archivedAt !== null).sort((a, b) => (b.archivedAt ?? 0) - (a.archivedAt ?? 0));

/** Drops the oldest archived packages beyond MAX_ARCHIVED. */
function trimArchive(): void {
	const drop = new Set(archivedNewestFirst(packages ?? []).slice(MAX_ARCHIVED).map((p) => p.id));
	if (drop.size > 0) packages = (packages ?? []).filter((p) => !drop.has(p.id));
}

async function save(): Promise<void> {
	await mkdir(path.dirname(config.packagesFile), { recursive: true });
	const tmp = `${config.packagesFile}.tmp`;
	await writeFile(tmp, JSON.stringify(packages, null, 1));
	await rename(tmp, config.packagesFile);
}

export const carrierStatus = (): PackagesData['carriers'] => ({
	posti: true,
	matkahuolto: true,
	dhl: true,
	ups: config.upsClientId !== '' && config.upsClientSecret !== '',
	dsv: true
});

/** How often due packages are looked at without anyone on the dashboard (notifications only). */
const BACKGROUND_MS = 5 * 60_000;

/** "Shoes · Matkahuolto, Espoo, by la 18.10." */
function pickupText(p: TrackedPackage): string {
	const pickup = p.tracking?.pickup;
	let until: string | null = null;
	try {
		until = pickup?.until ? dayOf(pickup.until) : null;
	} catch {
		until = pickup?.until ?? null;
	}
	return [p.label ?? p.code, [carrierName(p.carrier), pickup?.name].filter(Boolean).join(', '), until && `by ${until}`].filter(Boolean).join(' · ');
}

async function check(p: TrackedPackage): Promise<void> {
	const tracker = TRACKERS[p.carrier];
	if (!tracker) return;
	// The first check happens while the package is being added: whoever adds it sees its state.
	const first = p.checkedAt === null;
	const before = p.tracking?.state ?? null;
	try {
		p.tracking = await tracker.track(p.code);
		p.error = null;
		if (p.tracking.state === 'delivered') p.deliveredAt ??= Date.now();
		else p.deliveredAt = null;
		if (!first && before !== 'pickup' && p.tracking.state === 'pickup') {
			void notify({ topic: 'packages', title: 'Package ready for pickup', body: pickupText(p), url: config.dashboardAppUrl });
		}
	} catch (e) {
		p.error = e instanceof NotFoundError ? e.message : (e as Error).message.slice(0, 200);
		if (!(e instanceof NotFoundError)) console.error(`package ${p.carrier} check failed: ${p.error}`);
	}
	p.checkedAt = Date.now();
}

function due(p: TrackedPackage, now: number): boolean {
	const tracker = TRACKERS[p.carrier];
	return (
		!!tracker &&
		p.archivedAt === null &&
		p.deliveredAt === null &&
		(p.checkedAt === null || now - p.checkedAt >= (p.error ? RETRY_MS : tracker.refreshMs))
	);
}

/** Done with: delivered a while ago, or a link-only package past its time on the card. */
const finished = (p: TrackedPackage, now: number) =>
	LINK_ONLY.has(p.carrier)
		? now >= linkOnlyUntil(p)
		: p.deliveredAt !== null && now - Math.max(p.deliveredAt, p.restoredAt ?? 0) >= KEEP_DELIVERED_MS;

let refreshing = false;

/** Due packages are checked in the background, one pass at a time (the next poll shows the result). */
function refreshDue(): void {
	const now = Date.now();
	if (refreshing || !(packages ?? []).some((p) => due(p, now))) return;
	refreshing = true;
	void serial(async () => {
		for (const p of (packages ?? []).filter((p) => due(p, Date.now()))) await check(p);
		await save();
	}).finally(() => (refreshing = false));
}

/** With notifications set up, packages are checked even when nobody has the dashboard open. */
export function startBackgroundRefresh(): void {
	if (!notifyConfigured()) return;
	setInterval(() => void serial(load).then(refreshDue, (e) => console.error(`packages: ${(e as Error).message}`)), BACKGROUND_MS).unref();
}

/** The packages on the card; finished ones move to the archive, due ones are refreshed in the background. */
export async function listPackages(): Promise<PackagesData> {
	const { list, archived } = await serial(async () => {
		const now = Date.now();
		const all = await load();
		const done = active(all).filter((p) => finished(p, now));
		if (done.length > 0) {
			for (const p of done) p.archivedAt = now;
			trimArchive();
			await save();
		}
		const current = packages ?? [];
		return { list: active(current), archived: current.length - active(current).length };
	});
	refreshDue();
	return { packages: list, archived, carriers: carrierStatus() };
}

/** Archived packages, most recently archived first. */
export async function listArchived(): Promise<TrackedPackage[]> {
	return serial(async () => archivedNewestFirst(await load()));
}

export async function addPackage(input: { code: string; label?: string | null; carrier?: Carrier | null }): Promise<TrackedPackage> {
	const code = normalizeCode(input.code ?? '');
	if (!/^[A-Z0-9]{8,40}$/.test(code)) throw new PackageInputError('That does not look like a tracking code.');
	const carrier = input.carrier ?? detectCarrier(code);
	if (!carrier || !CARRIERS.some((c) => c.id === carrier)) throw new PackageInputError('Choose the carrier for this code.');
	if (!carrierStatus()[carrier]) throw new PackageInputError(`${carrierName(carrier)} tracking is not set up yet.`);
	return serial(async () => {
		const list = await load();
		const existing = list.find((p) => p.code === code);
		// Adding an archived package again takes it back out of the archive.
		if (existing?.archivedAt != null) return restore(existing, active(list).length);
		if (existing) throw new PackageInputError('That package is already on the card.');
		if (active(list).length >= MAX_PACKAGES) throw new PackageInputError('Too many packages; archive some first.');
		const p: TrackedPackage = {
			id: randomUUID(),
			code,
			carrier,
			label: input.label?.trim().slice(0, 40) || null,
			addedAt: Date.now(),
			checkedAt: null,
			error: null,
			deliveredAt: null,
			tracking: null,
			archivedAt: null,
			restoredAt: null
		};
		await check(p);
		list.unshift(p);
		await save();
		return p;
	});
}

async function restore(p: TrackedPackage, onCard: number): Promise<TrackedPackage> {
	if (onCard >= MAX_PACKAGES) throw new PackageInputError('Too many packages on the card; archive some first.');
	p.archivedAt = null;
	p.restoredAt = Date.now();
	await save();
	return p;
}

/** Moves a package to the archive or back to the card; null when there is no such package. */
export async function setArchived(id: string, archived: boolean): Promise<TrackedPackage | null> {
	return serial(async () => {
		const list = await load();
		const p = list.find((x) => x.id === id);
		if (!p) return null;
		if (!archived) return p.archivedAt === null ? p : restore(p, active(list).length);
		if (p.archivedAt === null) {
			p.archivedAt = Date.now();
			trimArchive();
			await save();
		}
		return p;
	});
}

export async function removePackage(id: string): Promise<boolean> {
	return serial(async () => {
		const list = await load();
		const next = list.filter((p) => p.id !== id);
		if (next.length === list.length) return false;
		packages = next;
		await save();
		return true;
	});
}
