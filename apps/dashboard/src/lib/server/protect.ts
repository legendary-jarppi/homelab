// UniFi Protect on the home UDM Pro and the cabin's UCG Max: motion events, their thumbnails and
// clips for the Cameras tab, and the cabin cameras' snapshots for their live tiles.
//
// Uses Protect's private API (/proxy/protect/api), the one its web app and Home Assistant use: the
// official integration API (/proxy/protect/integration/v1) has no event history and no recordings.
// Undocumented, so a Protect update may change it. Login with a local UniFi account (PROTECT_USER,
// PROTECT_PASS; view-only is enough; the same account on both consoles): cookie TOKEN, valid about
// 2 h, renewed on 401. The consoles' certificates are self-signed and not verified (LAN and the Site
// Magic VPN only, as UnPoller).

import { createWriteStream } from 'node:fs';
import { mkdir, readdir, rename, stat, unlink } from 'node:fs/promises';
import { Agent, request } from 'node:https';
import type { IncomingMessage } from 'node:http';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { gunzipSync } from 'node:zlib';
import type { ProtectSite } from '$lib/types';
import { config, type ProtectCameraConfig } from './config';

export class ProtectError extends Error {}

const agent = new Agent({ rejectUnauthorized: false, keepAlive: true });

/** Event ids are UUIDs (older Protect versions: 24 hex digits). */
export const isEventId = (id: string): boolean => /^[0-9a-f][0-9a-f-]{22,40}$/i.test(id);

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

export interface ProtectEvent {
	id: string;
	camera: string;
	start: number;
	end: number;
	/** Smart detections (person, vehicle, animal, …); empty for plain motion. */
	types: string[];
}

/** Events shown: this far back (at most EVENT_LIMIT; the cabin's cameras reach that in about 13 h of wind). */
export const WINDOW_HOURS = 48;
const EVENT_LIMIT = 1000;
const TYPES = ['motion', 'smartDetectZone', 'smartDetectLine'];
/** After a failed login, wait this long: UniFi OS locks accounts out after repeated failures. */
const LOGIN_BACKOFF_MS = 60_000;

// Clips: Protect exports MP4 on request (H.264 + AAC) with a Content-Length but ignores Range, which
// Safari needs to play video. So each clip is exported once into CLIP_DIR (the pod's /tmp emptyDir,
// shared by both consoles) and served from there with Range; the oldest go when the folder is over
// CLIP_DIR_MAX_BYTES.
const CLIP_DIR = path.join(process.env.TMPDIR ?? '/tmp', 'protect-clips');
const CLIP_DIR_MAX_BYTES = 800_000_000;
/**
 * Channel 0: full resolution (2688x1512, about 0.7 MB per second of video; the UDM exports it at
 * about 8 MB/s, the cabin's UCG Max at about 2 MB/s over its mobile link). Protect records only that
 * and the 640x360 channel 2; asking for channel 1 (720p) gets 640x360 too, too blurry for the
 * full-screen viewer.
 */
const CLIP_CHANNEL = 0;
/** Seconds of recording kept on both sides of the event. */
const PAD_MS = 2_000;
/** Longer events are cut to their first three minutes (about 130 MB). */
const MAX_CLIP_MS = 3 * 60_000;
/** Room kept free in CLIP_DIR for one export of MAX_CLIP_MS. */
const CLIP_RESERVE_BYTES = 150_000_000;
/** Snapshots are shared by every tile asking within this long (tiles refresh every 5 s). */
const SNAPSHOT_TTL_MS = 4_000;

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

/** One Protect console: its session, camera list, events, thumbnails, clips and snapshots. */
class ProtectConsole {
	private token: string | null = null;
	private loggingIn: Promise<string> | null = null;
	private loginFailedAt = 0;
	private readonly exporting = new Map<string, Promise<string>>();
	private readonly snapshots = new Map<string, () => Promise<Buffer>>();

	constructor(
		readonly site: ProtectSite,
		private readonly url: string,
		readonly configured: ProtectCameraConfig[]
	) {}

	private send(method: 'GET' | 'POST', apiPath: string, headers: Record<string, string>, body?: string): Promise<IncomingMessage> {
		const { promise, resolve, reject } = Promise.withResolvers<IncomingMessage>();
		const req = request(new URL(apiPath, this.url), { method, agent, headers, timeout: 30_000 }, resolve);
		req.on('timeout', () => req.destroy(new ProtectError(`${this.site} ${apiPath}: timed out`)));
		req.on('error', reject);
		req.end(body);
		return promise;
	}

	private login(): Promise<string> {
		if (Date.now() - this.loginFailedAt < LOGIN_BACKOFF_MS) return Promise.reject(new ProtectError(`${this.site}: login failed less than a minute ago`));
		this.loggingIn ??= (async () => {
			const body = JSON.stringify({ username: config.protectUser, password: config.protectPass, rememberMe: false });
			const res = await this.send('POST', '/api/auth/login', { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(body)) }, body);
			res.resume();
			const cookie = (res.headers['set-cookie'] ?? []).map((c) => /^TOKEN=([^;]+)/.exec(c)?.[1]).find(Boolean);
			if (res.statusCode !== 200 || !cookie) {
				this.loginFailedAt = Date.now();
				throw new ProtectError(`${this.site} login: HTTP ${res.statusCode}`);
			}
			console.log(`protect ${this.site}: logged in`);
			return (this.token = cookie);
		})().finally(() => (this.loggingIn = null));
		return this.loggingIn;
	}

	/** GET under /proxy/protect/api/; logs in again once when the session has expired. */
	private async get(apiPath: string, headers: Record<string, string> = {}): Promise<IncomingMessage> {
		for (let attempt = 0; ; attempt++) {
			const session = this.token ?? (await this.login());
			const res = await this.send('GET', `/proxy/protect/api/${apiPath}`, { ...headers, cookie: `TOKEN=${session}` });
			if (res.statusCode === 401 && attempt === 0) {
				res.resume();
				if (this.token === session) this.token = null;
				continue;
			}
			if (res.statusCode !== 200) {
				res.resume();
				throw new ProtectError(`${this.site} ${apiPath.split('?')[0]}: HTTP ${res.statusCode}`);
			}
			return res;
		}
	}

	/**
	 * JSON gzipped: the cabin's 1000 events are 670 KB plain and 80 KB gzipped, polled every 30 s over
	 * its mobile link.
	 */
	private async getJson<T>(apiPath: string): Promise<T> {
		const res = await this.get(apiPath, { 'accept-encoding': 'gzip' });
		const body = await readBody(res, 4_000_000);
		return JSON.parse((res.headers['content-encoding'] === 'gzip' ? gunzipSync(body, { maxOutputLength: 16_000_000 }) : body).toString()) as T;
	}

	/** Protect's cameras as it names them. */
	private readonly allCameras = cached(10 * 60_000, () => this.getJson<{ id: string; name: string }[]>('cameras'));

	/** Protect's cameras in configured order with their labels; cameras not listed follow with their Protect names. */
	private async cameras(): Promise<ProtectCamera[]> {
		const listed = (await this.allCameras()).map((c) => {
			const i = this.configured.findIndex((p) => p.name === c.name.normalize('NFC'));
			return { id: c.id, label: this.configured[i]?.label ?? c.name, rank: i === -1 ? this.configured.length : i };
		});
		return listed.sort((a, b) => a.rank - b.rank).map(({ id, label }) => ({ id, label }));
	}

	/** Ended motion and smart-detection events of the last WINDOW_HOURS, newest first (ongoing ones have no thumbnail or clip yet). */
	private readonly events = cached(15_000, async (): Promise<ProtectEvent[]> => {
		const end = Date.now();
		const query = new URLSearchParams({ start: String(end - WINDOW_HOURS * 3_600_000), end: String(end), orderDirection: 'DESC', limit: String(EVENT_LIMIT), withoutDescriptions: 'true' });
		for (const t of TYPES) query.append('types', t);
		const raw = await this.getJson<{ id: string; camera: string; start: number; end: number | null; smartDetectTypes?: string[] }[]>(`events?${query}`);
		return raw
			.filter((e): e is typeof e & { end: number } => e.end !== null)
			.map((e) => ({ id: e.id, camera: e.camera, start: e.start, end: e.end, types: e.smartDetectTypes ?? [] }));
	});

	async data(): Promise<{ cameras: ProtectCamera[]; events: ProtectEvent[] }> {
		const [cams, evs] = await Promise.all([this.cameras(), this.events()]);
		const known = new Set(cams.map((c) => c.id));
		return { cameras: cams, events: evs.filter((e) => known.has(e.camera)) };
	}

	/** An event's JPEG thumbnail (made by Protect once the event has ended), 640 px wide. */
	async thumbnail(id: string): Promise<Buffer> {
		return readBody(await this.get(`events/${id}/thumbnail?w=640`), 2_000_000);
	}

	/** Path of the event's clip on disk, exported from Protect if it is not there yet. */
	clipFile(id: string): Promise<string> {
		const file = path.join(CLIP_DIR, `${this.site}-${id}.mp4`);
		let pending = this.exporting.get(id);
		if (!pending) {
			pending = (async () => {
				if (await stat(file).then(() => true, () => false)) return file;
				const event = await this.getJson<{ camera: string; start: number; end: number | null }>(`events/${id}`);
				if (event.end === null) throw new ProtectError('event still ongoing');
				const end = Math.min(event.end, event.start + MAX_CLIP_MS) + PAD_MS;
				const query = new URLSearchParams({ camera: event.camera, start: String(event.start - PAD_MS), end: String(end), channel: String(CLIP_CHANNEL) });
				await mkdir(CLIP_DIR, { recursive: true });
				await prune();
				const res = await this.get(`video/export?${query}`);
				const partial = `${file}.part`;
				try {
					await pipeline(res, createWriteStream(partial));
					await rename(partial, file);
				} catch (e) {
					await unlink(partial).catch(() => {});
					throw e;
				}
				return file;
			})().finally(() => this.exporting.delete(id));
			this.exporting.set(id, pending);
		}
		return pending;
	}

	/**
	 * The camera's current picture as a JPEG (Protect makes 640x360, about 25 KB): what the cabin
	 * cameras' live tiles show, much cheaper over the cabin's mobile link than a frame from the stream.
	 */
	snapshot(name: string): Promise<Buffer> {
		let load = this.snapshots.get(name);
		if (!load) {
			load = cached(SNAPSHOT_TTL_MS, async () => {
				const camera = (await this.allCameras()).find((c) => c.name.normalize('NFC') === name);
				if (!camera) throw new ProtectError(`${this.site}: no camera named ${name}`);
				return readBody(await this.get(`cameras/${camera.id}/snapshot?ts=${Date.now()}`), 2_000_000);
			});
			this.snapshots.set(name, load);
		}
		return load();
	}
}

const loginSet = config.protectUser !== '' && config.protectPass !== '';

/** Each site's console; null when not configured (no login, or no cabin URL). */
export const consoles: Record<ProtectSite, ProtectConsole | null> = {
	home: loginSet ? new ProtectConsole('home', config.protectUrl, config.protectCameras) : null,
	cabin: loginSet && config.cabinProtectUrl ? new ProtectConsole('cabin', config.cabinProtectUrl, config.cabinProtectCameras) : null
};

/** The console of a route's `site` parameter, or null for an unknown or unconfigured site. */
export const consoleOf = (site: string): ProtectConsole | null => (site === 'home' || site === 'cabin' ? consoles[site] : null);
