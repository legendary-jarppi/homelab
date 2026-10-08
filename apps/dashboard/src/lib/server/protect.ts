// UniFi Protect on the UDM Pro: motion events, their thumbnails and clips for the Cameras tab.
//
// Uses Protect's private API (/proxy/protect/api), the one its web app and Home Assistant use: the
// official integration API (/proxy/protect/integration/v1) has no event history and no recordings.
// Undocumented, so a Protect update may change it. Login with a local UniFi account (PROTECT_USER,
// PROTECT_PASS; view-only is enough): cookie TOKEN, valid about 2 h, renewed on 401. The UDM's
// certificate is self-signed and not verified (LAN only, as UnPoller).

import { createWriteStream } from 'node:fs';
import { mkdir, readdir, rename, stat, unlink } from 'node:fs/promises';
import { Agent, request } from 'node:https';
import type { IncomingMessage } from 'node:http';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { config } from './config';

export class ProtectError extends Error {}

const agent = new Agent({ rejectUnauthorized: false, keepAlive: true });

/** Event ids are UUIDs (older Protect versions: 24 hex digits). */
export const isEventId = (id: string): boolean => /^[0-9a-f][0-9a-f-]{22,40}$/i.test(id);

function send(method: 'GET' | 'POST', apiPath: string, headers: Record<string, string>, body?: string): Promise<IncomingMessage> {
	return new Promise((resolve, reject) => {
		const req = request(new URL(apiPath, config.protectUrl), { method, agent, headers, timeout: 30_000 }, resolve);
		req.on('timeout', () => req.destroy(new ProtectError(`${apiPath}: timed out`)));
		req.on('error', reject);
		req.end(body);
	});
}

async function readBody(res: IncomingMessage, maxBytes: number): Promise<Buffer> {
	const chunks: Buffer[] = [];
	let size = 0;
	for await (const chunk of res) {
		size += chunk.length;
		if (size > maxBytes) {
			res.destroy();
			throw new ProtectError(`response over ${maxBytes} bytes`);
		}
		chunks.push(chunk);
	}
	return Buffer.concat(chunks);
}

let token: string | null = null;
let loggingIn: Promise<string> | null = null;
/** After a failed login, wait this long: UniFi OS locks accounts out after repeated failures. */
const LOGIN_BACKOFF_MS = 60_000;
let loginFailedAt = 0;

function login(): Promise<string> {
	if (Date.now() - loginFailedAt < LOGIN_BACKOFF_MS) return Promise.reject(new ProtectError('login failed less than a minute ago'));
	loggingIn ??= (async () => {
		const body = JSON.stringify({ username: config.protectUser, password: config.protectPass, rememberMe: false });
		const res = await send('POST', '/api/auth/login', { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(body)) }, body);
		res.resume();
		const cookie = (res.headers['set-cookie'] ?? []).map((c) => /^TOKEN=([^;]+)/.exec(c)?.[1]).find(Boolean);
		if (res.statusCode !== 200 || !cookie) {
			loginFailedAt = Date.now();
			throw new ProtectError(`login: HTTP ${res.statusCode}`);
		}
		console.log('protect: logged in');
		return (token = cookie);
	})().finally(() => (loggingIn = null));
	return loggingIn;
}

/** GET under /proxy/protect/api/; logs in again once when the session has expired. */
async function get(apiPath: string): Promise<IncomingMessage> {
	for (let attempt = 0; ; attempt++) {
		const session = token ?? (await login());
		const res = await send('GET', `/proxy/protect/api/${apiPath}`, { cookie: `TOKEN=${session}` });
		if (res.statusCode === 401 && attempt === 0) {
			res.resume();
			if (token === session) token = null;
			continue;
		}
		if (res.statusCode !== 200) {
			res.resume();
			throw new ProtectError(`${apiPath.split('?')[0]}: HTTP ${res.statusCode}`);
		}
		return res;
	}
}

const getJson = async <T>(apiPath: string): Promise<T> => JSON.parse((await readBody(await get(apiPath), 4_000_000)).toString()) as T;

/** One single-flight cached value: concurrent and repeated callers within `ttlMs` share a fetch. */
function cached<T>(ttlMs: number, load: () => Promise<T>): () => Promise<T> {
	let value: { at: number; data: Promise<T> } | null = null;
	return () => {
		if (!value || Date.now() - value.at > ttlMs) {
			const data = load();
			value = { at: Date.now(), data };
			data.catch(() => value?.data === data && (value = null));
		}
		return value.data;
	};
}

export interface ProtectCamera {
	id: string;
	label: string;
}

/** Protect's cameras in PROTECT_CAMERAS order with its labels; cameras not listed follow with their Protect names. */
const cameras = cached(10 * 60_000, async (): Promise<ProtectCamera[]> => {
	const all = await getJson<{ id: string; name: string }[]>('cameras');
	const rank = (name: string) => {
		const i = config.protectCameras.findIndex((c) => c.name === name);
		return i === -1 ? config.protectCameras.length : i;
	};
	return all
		.sort((a, b) => rank(a.name) - rank(b.name))
		.map((c) => ({ id: c.id, label: config.protectCameras.find((p) => p.name === c.name)?.label ?? c.name }));
});

export interface ProtectEvent {
	id: string;
	camera: string;
	start: number;
	end: number;
	/** Smart detections (person, vehicle, animal, …); empty for plain motion. */
	types: string[];
}

/** Events shown: this far back. */
export const WINDOW_HOURS = 48;
const TYPES = ['motion', 'smartDetectZone', 'smartDetectLine'];

/** Ended motion and smart-detection events of the last WINDOW_HOURS, newest first (ongoing ones have no thumbnail or clip yet). */
const events = cached(15_000, async (): Promise<ProtectEvent[]> => {
	const end = Date.now();
	const query = new URLSearchParams({ start: String(end - WINDOW_HOURS * 3_600_000), end: String(end), orderDirection: 'DESC', limit: '1000', withoutDescriptions: 'true' });
	for (const t of TYPES) query.append('types', t);
	const raw = await getJson<{ id: string; camera: string; start: number; end: number | null; smartDetectTypes?: string[] }[]>(`events?${query}`);
	return raw
		.filter((e): e is typeof e & { end: number } => e.end !== null)
		.map((e) => ({ id: e.id, camera: e.camera, start: e.start, end: e.end, types: e.smartDetectTypes ?? [] }));
});

export async function protectData(): Promise<{ cameras: ProtectCamera[]; events: ProtectEvent[] }> {
	const [cams, evs] = await Promise.all([cameras(), events()]);
	const known = new Set(cams.map((c) => c.id));
	return { cameras: cams, events: evs.filter((e) => known.has(e.camera)) };
}

/** An event's JPEG thumbnail (made by Protect once the event has ended), 640 px wide. */
export async function thumbnail(id: string): Promise<Buffer> {
	return readBody(await get(`events/${id}/thumbnail?w=640`), 2_000_000);
}

// Clips: Protect exports MP4 on request (H.264 + AAC) with a Content-Length but ignores Range, which
// Safari needs to play video. So each clip is exported once into CLIP_DIR (the pod's /tmp emptyDir)
// and served from there with Range; the oldest go when the folder is over CLIP_DIR_MAX_BYTES.
const CLIP_DIR = path.join(process.env.TMPDIR ?? '/tmp', 'protect-clips');
const CLIP_DIR_MAX_BYTES = 800_000_000;
/**
 * Channel 0: full resolution (2688x1512, about 0.7 MB per second of video; the UDM exports it at
 * about 8 MB/s). Protect records only that and the 640x360 channel 2; asking for channel 1 (720p)
 * gets 640x360 too, too blurry for the full-screen viewer.
 */
const CLIP_CHANNEL = 0;
/** Seconds of recording kept on both sides of the event. */
const PAD_MS = 2_000;
/** Longer events are cut to their first three minutes (about 130 MB). */
const MAX_CLIP_MS = 3 * 60_000;
/** Room kept free in CLIP_DIR for one export of MAX_CLIP_MS. */
const CLIP_RESERVE_BYTES = 150_000_000;
const exporting = new Map<string, Promise<string>>();

/** Path of the event's clip on disk, exported from Protect if it is not there yet. */
export function clipFile(id: string): Promise<string> {
	const file = path.join(CLIP_DIR, `${id}.mp4`);
	let pending = exporting.get(id);
	if (!pending) {
		pending = (async () => {
			if (await stat(file).then(() => true, () => false)) return file;
			const event = await getJson<{ camera: string; start: number; end: number | null }>(`events/${id}`);
			if (event.end === null) throw new ProtectError('event still ongoing');
			const end = Math.min(event.end, event.start + MAX_CLIP_MS) + PAD_MS;
			const query = new URLSearchParams({ camera: event.camera, start: String(event.start - PAD_MS), end: String(end), channel: String(CLIP_CHANNEL) });
			await mkdir(CLIP_DIR, { recursive: true });
			await prune();
			const res = await get(`video/export?${query}`);
			const partial = `${file}.part`;
			try {
				await pipeline(res, createWriteStream(partial));
				await rename(partial, file);
			} catch (e) {
				await unlink(partial).catch(() => {});
				throw e;
			}
			return file;
		})().finally(() => exporting.delete(id));
		exporting.set(id, pending);
	}
	return pending;
}

async function prune(): Promise<void> {
	const names = (await readdir(CLIP_DIR)).filter((n) => n.endsWith('.mp4'));
	const files = (await Promise.all(names.map(async (n) => ({ file: path.join(CLIP_DIR, n), ...(await stat(path.join(CLIP_DIR, n))) }))))
		.sort((a, b) => b.mtimeMs - a.mtimeMs);
	let total = 0;
	for (const f of files) {
		total += f.size;
		// Keep room for the clip about to be exported.
		if (total > CLIP_DIR_MAX_BYTES - CLIP_RESERVE_BYTES) await unlink(f.file).catch(() => {});
	}
}
