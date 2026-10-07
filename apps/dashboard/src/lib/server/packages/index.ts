// Tracked packages: a JSON file on the dashboard's volume (PACKAGES_FILE), refreshed from the
// carriers while someone is looking at the dashboard, never more often than each carrier allows.
// Link-only carriers (DHL) are never checked; their packages just link to the carrier's page.
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { config } from '$lib/server/config';
import { CARRIERS, carrierName, detectCarrier, LINK_ONLY, linkOnlyUntil, normalizeCode } from '$lib/packages';
import type { Carrier, PackageTracking, PackagesData, TrackedPackage } from '$lib/types';
import { NotFoundError } from './errors';
import { trackPosti } from './posti';
import { trackUps } from './ups';

const TRACKERS: Partial<Record<Carrier, { track: (code: string) => Promise<PackageTracking>; refreshMs: number }>> = {
	posti: { track: trackPosti, refreshMs: 20 * 60_000 },
	ups: { track: trackUps, refreshMs: 20 * 60_000 }
};
/** Failed checks (including "not found yet") are retried less eagerly. */
const RETRY_MS = 30 * 60_000;
/** Delivered packages stay on the card this long. */
const KEEP_DELIVERED_MS = 2 * 86_400_000;
const MAX_PACKAGES = 30;

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
		packages = JSON.parse(await readFile(config.packagesFile, 'utf8')) as TrackedPackage[];
	} catch (e) {
		if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
		packages = [];
	}
	return packages;
}

async function save(): Promise<void> {
	await mkdir(path.dirname(config.packagesFile), { recursive: true });
	const tmp = `${config.packagesFile}.tmp`;
	await writeFile(tmp, JSON.stringify(packages, null, 1));
	await rename(tmp, config.packagesFile);
}

export const carrierStatus = (): PackagesData['carriers'] => ({
	posti: true,
	dhl: true,
	ups: config.upsClientId !== '' && config.upsClientSecret !== ''
});

async function check(p: TrackedPackage): Promise<void> {
	const tracker = TRACKERS[p.carrier];
	if (!tracker) return;
	try {
		p.tracking = await tracker.track(p.code);
		p.error = null;
		if (p.tracking.state === 'delivered') p.deliveredAt ??= Date.now();
		else p.deliveredAt = null;
	} catch (e) {
		p.error = e instanceof NotFoundError ? e.message : (e as Error).message.slice(0, 200);
		if (!(e instanceof NotFoundError)) console.error(`package ${p.carrier} check failed: ${p.error}`);
	}
	p.checkedAt = Date.now();
}

function due(p: TrackedPackage, now: number): boolean {
	const tracker = TRACKERS[p.carrier];
	return !!tracker && p.deliveredAt === null && (p.checkedAt === null || now - p.checkedAt >= (p.error ? RETRY_MS : tracker.refreshMs));
}

const kept = (p: TrackedPackage, now: number) =>
	LINK_ONLY.has(p.carrier) ? now < linkOnlyUntil(p) : p.deliveredAt === null || now - p.deliveredAt < KEEP_DELIVERED_MS;

let refreshing = false;

/** Current list; due packages are refreshed in the background (the next poll shows the result). */
export async function listPackages(): Promise<PackagesData> {
	const list = await serial(async () => {
		const now = Date.now();
		const all = await load();
		const keep = all.filter((p) => kept(p, now));
		if (keep.length !== all.length) {
			packages = keep;
			await save();
		}
		return keep;
	});
	const now = Date.now();
	if (!refreshing && list.some((p) => due(p, now))) {
		refreshing = true;
		void serial(async () => {
			for (const p of (packages ?? []).filter((p) => due(p, Date.now()))) await check(p);
			await save();
		}).finally(() => (refreshing = false));
	}
	return { packages: list, carriers: carrierStatus() };
}

export async function addPackage(input: { code: string; label?: string | null; carrier?: Carrier | null }): Promise<TrackedPackage> {
	const code = normalizeCode(input.code ?? '');
	if (!/^[A-Z0-9]{8,40}$/.test(code)) throw new PackageInputError('That does not look like a tracking code.');
	const carrier = input.carrier ?? detectCarrier(code);
	if (!carrier || !CARRIERS.some((c) => c.id === carrier)) throw new PackageInputError('Choose the carrier for this code.');
	if (!carrierStatus()[carrier]) throw new PackageInputError(`${carrierName(carrier)} tracking is not set up yet.`);
	return serial(async () => {
		const list = await load();
		if (list.some((p) => p.code === code)) throw new PackageInputError('That package is already on the card.');
		if (list.length >= MAX_PACKAGES) throw new PackageInputError('Too many packages; remove some first.');
		const p: TrackedPackage = {
			id: randomUUID(),
			code,
			carrier,
			label: input.label?.trim().slice(0, 40) || null,
			addedAt: Date.now(),
			checkedAt: null,
			error: null,
			deliveredAt: null,
			tracking: null
		};
		await check(p);
		list.unshift(p);
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
