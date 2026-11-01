// Tracked packages: a JSON file on the dashboard's volume (PACKAGES_FILE), refreshed from the
// carriers while someone is looking at the dashboard, and every few minutes when notifications are
// set up (a package becoming ready for pickup is sent through apps/notify), never more often than
// each carrier allows.
// Link-only carriers (DHL) are never checked; their packages just link to the carrier's page.
// A package can be added before its tracking code (a name only, not checked); the code comes later.
// Packages leave the card for the archive (same file, `archivedAt` set, no longer checked) when
// archived by hand, two days after delivery, or when a link-only package's time is up. Returned
// packages (all or part sent back) stay on the card, unchecked, until archived by hand once the
// refund has come.
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { config } from '$lib/server/config';
import { CARRIERS, carrierName, detectCarrier, isLinkOnly, linkOnlyUntil, normalizeCode, packageName } from '$lib/packages';
import { dayOf } from '$lib/dates';
import type { Carrier, PackageReturn, PackageTracking, PackagesData, TrackedPackage } from '$lib/types';
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
			// Files written before the archive, codes added later and returns existed.
			archivedAt: p.archivedAt ?? null,
			restoredAt: p.restoredAt ?? null,
			codeAddedAt: p.codeAddedAt ?? null,
			returned: p.returned ?? null,
			returnedAt: p.returnedAt ?? null
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
	const carrier = p.carrier && carrierName(p.carrier);
	return [packageName(p), [carrier, pickup?.name].filter(Boolean).join(', '), until && `by ${until}`].filter(Boolean).join(' · ');
}

async function check(p: TrackedPackage): Promise<void> {
	const tracker = p.carrier && TRACKERS[p.carrier];
	if (!tracker || p.code === null) return;
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
	const tracker = p.carrier && TRACKERS[p.carrier];
	return (
		!!tracker &&
		p.archivedAt === null &&
		p.returned === null &&
		p.deliveredAt === null &&
		(p.checkedAt === null || now - p.checkedAt >= (p.error ? RETRY_MS : tracker.refreshMs))
	);
}

/**
 * Done with: delivered a while ago, or a link-only package past its time on the card. Never a
 * returned package (its refund is still to be checked) or one still waiting for its code.
 */
const finished = (p: TrackedPackage, now: number) =>
	p.returned === null &&
	p.code !== null &&
	(isLinkOnly(p) ? now >= linkOnlyUntil(p) : p.deliveredAt !== null && now - Math.max(p.deliveredAt, p.restoredAt ?? 0) >= KEEP_DELIVERED_MS);

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

/** A typed or pasted code and the carrier for it (detected unless chosen); throws when either is unusable. */
function parseCode(raw: string, chosen: Carrier | null | undefined): { code: string; carrier: Carrier } {
	const code = normalizeCode(raw);
	if (!/^[A-Z0-9]{8,40}$/.test(code)) throw new PackageInputError('That does not look like a tracking code.');
	const carrier = chosen ?? detectCarrier(code);
	if (!carrier || !CARRIERS.some((c) => c.id === carrier)) throw new PackageInputError('Choose the carrier for this code.');
	if (!carrierStatus()[carrier]) throw new PackageInputError(`${carrierName(carrier)} tracking is not set up yet.`);
	return { code, carrier };
}

/** With a tracking code, or without one (then the name is required) when the code is still to come. */
export async function addPackage(input: { code?: string | null; label?: string | null; carrier?: Carrier | null }): Promise<TrackedPackage> {
	const label = input.label?.trim().slice(0, 40) || null;
	const parsed = input.code?.trim() ? parseCode(input.code, input.carrier) : null;
	if (!parsed && !label) throw new PackageInputError('Give the package a name, or its tracking code.');
	return serial(async () => {
		const list = await load();
		const existing = parsed && list.find((p) => p.code === parsed.code);
		// Adding an archived package again takes it back out of the archive.
		if (existing?.archivedAt != null) return restore(existing, active(list).length);
		if (existing) throw new PackageInputError('That package is already on the card.');
		if (active(list).length >= MAX_PACKAGES) throw new PackageInputError('Too many packages; archive some first.');
		const p: TrackedPackage = {
			id: randomUUID(),
			code: parsed?.code ?? null,
			carrier: parsed?.carrier ?? null,
			label,
			addedAt: Date.now(),
			codeAddedAt: null,
			checkedAt: null,
			error: null,
			deliveredAt: null,
			tracking: null,
			archivedAt: null,
			restoredAt: null,
			returned: null,
			returnedAt: null
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

/**
 * Changes a package: its name (empty = none, the code is shown; a package without a code keeps
 * its name), its tracking code (checked right away), whether it was returned (marking an archived
 * package returned puts it back on the card), and/or moves it to the archive or back to the card.
 * null when there is no such package.
 */
export async function updatePackage(
	id: string,
	change: { label?: string | null; code?: string; carrier?: Carrier | null; returned?: PackageReturn | null; archived?: boolean }
): Promise<TrackedPackage | null> {
	const parsed = change.code !== undefined ? parseCode(change.code, change.carrier) : null;
	return serial(async () => {
		const list = await load();
		const p = list.find((x) => x.id === id);
		if (!p) return null;
		if (change.label !== undefined) {
			const label = change.label?.trim().slice(0, 40) || null;
			if (!label && p.code === null && !parsed) throw new PackageInputError('A package without a tracking code needs a name.');
			p.label = label;
		}
		if (parsed && parsed.code !== p.code) {
			if (list.some((x) => x !== p && x.code === parsed.code)) throw new PackageInputError('Another package already has that code.');
			Object.assign(p, { ...parsed, codeAddedAt: Date.now(), checkedAt: null, error: null, deliveredAt: null, tracking: null });
			await check(p);
		}
		if (change.returned !== undefined && change.returned !== p.returned) {
			p.returned = change.returned;
			p.returnedAt = change.returned ? Date.now() : null;
			if (change.returned && p.archivedAt !== null) return restore(p, active(list).length);
		}
		if (change.archived === false && p.archivedAt !== null) return restore(p, active(list).length);
		if (change.archived === true && p.archivedAt === null) {
			p.archivedAt = Date.now();
			trimArchive();
		}
		await save();
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
