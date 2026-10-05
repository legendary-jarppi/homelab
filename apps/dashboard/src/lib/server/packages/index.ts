// Tracked packages: a JSON file on the dashboard's volume (PACKAGES_FILE), refreshed from the
// carriers while someone is looking at the dashboard, never more often than each carrier allows.
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { config } from '$lib/server/config';
import { detectCarrier, normalizeCode } from '$lib/packages';
import type { Carrier, PackageTracking, PackagesData, TrackedPackage } from '$lib/types';
import { trackDhl } from './dhl';
import { NotFoundError } from './errors';
import { trackPosti } from './posti';
import { trackUps } from './ups';

const TRACKERS: Record<Carrier, (code: string) => Promise<PackageTracking>> = { posti: trackPosti, dhl: trackDhl, ups: trackUps };
/** DHL's free tier is 250 calls a day: hourly keeps ten packages well inside it. */
const REFRESH_MS: Record<Carrier, number> = { posti: 20 * 60_000, dhl: 60 * 60_000, ups: 20 * 60_000 };
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
	dhl: config.dhlApiKey !== '',
	ups: config.upsClientId !== '' && config.upsClientSecret !== ''
});

async function check(p: TrackedPackage): Promise<void> {
	try {
		p.tracking = await TRACKERS[p.carrier](p.code);
		p.error = null;
		if (p.tracking.state === 'delivered') p.deliveredAt ??= Date.now();
		else p.deliveredAt = null;
	} catch (e) {
		p.error = e instanceof NotFoundError ? e.message : (e as Error).message.slice(0, 200);
		if (!(e instanceof NotFoundError)) console.error(`package ${p.carrier} check failed: ${p.error}`);
	}
	p.checkedAt = Date.now();
}

const due = (p: TrackedPackage, now: number) =>
	p.deliveredAt === null && (p.checkedAt === null || now - p.checkedAt >= (p.error ? RETRY_MS : REFRESH_MS[p.carrier]));

let refreshing = false;

/** Current list; due packages are refreshed in the background (the next poll shows the result). */
export async function listPackages(): Promise<PackagesData> {
	const list = await serial(async () => {
		const now = Date.now();
		const all = await load();
		const kept = all.filter((p) => p.deliveredAt === null || now - p.deliveredAt < KEEP_DELIVERED_MS);
		if (kept.length !== all.length) {
			packages = kept;
			await save();
		}
		return kept;
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
	if (!carrier || !(carrier in TRACKERS)) throw new PackageInputError('Choose the carrier for this code.');
	if (!carrierStatus()[carrier]) throw new PackageInputError(`${carrier.toUpperCase()} tracking is not set up yet.`);
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
