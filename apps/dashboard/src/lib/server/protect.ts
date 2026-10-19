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
import { mkdir, open, readdir, rename, stat, unlink, utimes } from 'node:fs/promises';
import { Agent, request } from 'node:https';
import type { IncomingMessage } from 'node:http';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { gunzipSync } from 'node:zlib';
import { PIECE_MS } from '$lib/recording';
import type { CameraTimeline, ProtectSite } from '$lib/types';
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

// Clips and recording pieces: Protect exports MP4 on request (H.264 + AAC, index at the end) with a
// Content-Length but ignores Range, which Safari needs to play video. So each is exported once into
// CLIP_DIR (the pod's /tmp emptyDir, shared by both consoles) and served from there; the least
// recently used go when the folder is over CLIP_DIR_MAX_BYTES.
const CLIP_DIR = path.join(process.env.TMPDIR ?? '/tmp', 'protect-clips');
const CLIP_DIR_MAX_BYTES = 2_500_000_000;
/**
 * Channel 0: full resolution (2688x1512, about 0.7 MB per second of video; the UDM exports it at
 * over 30 MB/s, the cabin's UCG Max at about 3.5 MB/s over its mobile link). Protect records only
 * that and the 640x360 channel 2; asking for channel 1 (720p) gets 640x360 too, too blurry for the
 * full-screen viewer.
 */
const CLIP_CHANNEL = 0;
/** Channel of the stills shown while scrubbing the timeline: 640x360, about 57 KB, 0.5 s from the cabin. */
const STILL_CHANNEL = 2;
/** Seconds of recording kept on both sides of the event. */
const PAD_MS = 2_000;
/** Longer events are cut to their first three minutes (about 130 MB). */
const MAX_CLIP_MS = 3 * 60_000;
/** Room kept free in CLIP_DIR for one export of MAX_CLIP_MS. */
const CLIP_RESERVE_BYTES = 150_000_000;
/** Exports running at once per console; more wait (a scrub must not pile up exports on the cabin's link). */
const MAX_EXPORTS = 2;
/** Snapshots are shared by every tile asking within this long (tiles refresh every 5 s). */
const SNAPSHOT_TTL_MS = 4_000;

async function prune(): Promise<void> {
	const names = (await readdir(CLIP_DIR)).filter((n) => n.endsWith('.mp4'));
	const files = (await Promise.all(names.map(async (n) => ({ file: path.join(CLIP_DIR, n), ...(await stat(path.join(CLIP_DIR, n))) }))))
		.sort((a, b) => b.mtimeMs - a.mtimeMs);
	let total = 0;
	for (const f of files) {
		total += f.size;
		// Keep room for the export about to start.
		if (total > CLIP_DIR_MAX_BYTES - CLIP_RESERVE_BYTES) await unlink(f.file).catch(() => {});
	}
}

/** The boxes directly inside an MP4 box body (or a whole file's top level). */
function* boxes(buf: Buffer): Generator<{ type: string; body: Buffer }> {
	for (let pos = 0; pos + 8 <= buf.length; ) {
		let size = buf.readUInt32BE(pos);
		let header = 8;
		if (size === 1) {
			size = Number(buf.readBigUInt64BE(pos + 8));
			header = 16;
		} else if (size === 0) size = buf.length - pos;
		if (size < header) return;
		yield { type: buf.toString('latin1', pos + 4, pos + 8), body: buf.subarray(pos + header, pos + size) };
		pos += size;
	}
}

const child = (buf: Buffer, type: string): Buffer | undefined => boxes(buf).find((b) => b.type === type)?.body;

/**
 * Length of an exported MP4's video track in ms. Protect starts an export at the keyframe before the
 * requested start (up to 5 s earlier, no edit list) and ends it at the requested end (checked to a
 * frame), so the video begins at `end - duration`.
 */
async function videoDurationMs(file: string): Promise<number> {
	const fh = await open(file);
	try {
		const { size } = await fh.stat();
		const head = Buffer.alloc(16);
		for (let pos = 0; pos + 8 <= size; ) {
			await fh.read(head, 0, 16, pos);
			let boxSize = head.readUInt32BE(0);
			let header = 8;
			if (boxSize === 1) {
				boxSize = Number(head.readBigUInt64BE(8));
				header = 16;
			} else if (boxSize === 0) boxSize = size - pos;
			if (boxSize < header) break;
			if (head.toString('latin1', 4, 8) === 'moov') {
				const moov = Buffer.alloc(boxSize - header);
				await fh.read(moov, 0, moov.length, pos + header);
				for (const trak of boxes(moov)) {
					const mdia = trak.type === 'trak' ? child(trak.body, 'mdia') : undefined;
					const hdlr = mdia && child(mdia, 'hdlr');
					const mdhd = mdia && child(mdia, 'mdhd');
					if (!hdlr || !mdhd || hdlr.toString('latin1', 8, 12) !== 'vide') continue;
					const [timescale, duration] = mdhd[0] === 1 ? [mdhd.readUInt32BE(20), Number(mdhd.readBigUInt64BE(24))] : [mdhd.readUInt32BE(12), mdhd.readUInt32BE(16)];
					return (duration / timescale) * 1000;
				}
				break;
			}
			pos += boxSize;
		}
	} finally {
		await fh.close();
	}
	throw new ProtectError(`${path.basename(file)}: no video track`);
}

type RawCamera = { id: string; name: string; stats?: { video?: { recordingStart?: number } } };

/** One Protect console: its session, camera list, events, thumbnails, clips, recordings and snapshots. */
class ProtectConsole {
	private token: string | null = null;
	private loggingIn: Promise<string> | null = null;
	private loginFailedAt = 0;
	private readonly exporting = new Map<string, Promise<string>>();
	private exportsRunning = 0;
	private readonly exportQueue: (() => void)[] = [];
	private readonly snapshots = new Map<string, () => Promise<Buffer>>();

	constructor(
		readonly site: ProtectSite,
		private readonly url: string,
		readonly configured: ProtectCameraConfig[],
		/** Live tiles from Protect's snapshots instead of go2rtc frames (the cabin's mobile link). */
		readonly tileSnapshots: boolean
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
	private readonly allCameras = cached(10 * 60_000, () => this.getJson<RawCamera[]>('cameras'));

	/** Protect's camera by its (configured) name. */
	private async camera(name: string): Promise<RawCamera> {
		const camera = (await this.allCameras()).find((c) => c.name.normalize('NFC') === name);
		if (!camera) throw new ProtectError(`${this.site}: no camera named ${name}`);
		return camera;
	}

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

	/**
	 * Exports into `file` unless it is there already (then only marks it recently used); one export
	 * per file at a time, at most MAX_EXPORTS per console.
	 */
	private exportOnce(file: string, query: () => Promise<URLSearchParams>): Promise<string> {
		let pending = this.exporting.get(file);
		if (!pending) {
			pending = (async () => {
				if (await stat(file).then(() => true, () => false)) {
					await utimes(file, new Date(), new Date()).catch(() => {});
					return file;
				}
				const q = await query();
				while (this.exportsRunning >= MAX_EXPORTS) {
					const { promise, resolve } = Promise.withResolvers<void>();
					this.exportQueue.push(resolve);
					await promise;
				}
				this.exportsRunning++;
				const partial = `${file}.part`;
				try {
					await mkdir(CLIP_DIR, { recursive: true });
					await prune();
					await pipeline(await this.get(`video/export?${q}`), createWriteStream(partial));
					await rename(partial, file);
				} catch (e) {
					await unlink(partial).catch(() => {});
					throw e;
				} finally {
					this.exportsRunning--;
					this.exportQueue.shift()?.();
				}
				return file;
			})().finally(() => this.exporting.delete(file));
			this.exporting.set(file, pending);
		}
		return pending;
	}

	/** Path of the event's clip on disk, exported from Protect if it is not there yet. */
	clipFile(id: string): Promise<string> {
		return this.exportOnce(path.join(CLIP_DIR, `${this.site}-${id}.mp4`), async () => {
			const event = await this.getJson<{ camera: string; start: number; end: number | null }>(`events/${id}`);
			if (event.end === null) throw new ProtectError('event still ongoing');
			const end = Math.min(event.end, event.start + MAX_CLIP_MS) + PAD_MS;
			return new URLSearchParams({ camera: event.camera, start: String(event.start - PAD_MS), end: String(end), channel: String(CLIP_CHANNEL) });
		});
	}

	/**
	 * The recording piece [start, start + PIECE_MS) at full resolution: its file and when its video
	 * really begins (the keyframe before `start`).
	 */
	async recording(name: string, start: number): Promise<{ file: string; start: number; end: number }> {
		const camera = await this.camera(name);
		const end = start + PIECE_MS;
		const file = await this.exportOnce(path.join(CLIP_DIR, `${this.site}-rec-${camera.id}-${start}.mp4`), async () =>
			new URLSearchParams({ camera: camera.id, start: String(start), end: String(end), channel: String(CLIP_CHANNEL) })
		);
		return { file, start: Math.round(end - (await videoDurationMs(file))), end };
	}

	/** A still from the recording at `ts` (640x360), for scrubbing. */
	async recordingStill(name: string, ts: number): Promise<Buffer> {
		const camera = await this.camera(name);
		return readBody(await this.get(`cameras/${camera.id}/recording-snapshot?ts=${ts}&channel=${STILL_CHANNEL}`), 2_000_000);
	}

	/** The camera's motion and smart-detection events between `start` and `end` (at most EVENT_LIMIT, the newest). */
	async timeline(name: string, start: number, end: number): Promise<CameraTimeline> {
		const camera = await this.camera(name);
		const query = new URLSearchParams({ start: String(start), end: String(end), orderDirection: 'DESC', limit: String(EVENT_LIMIT), withoutDescriptions: 'true', cameras: camera.id });
		for (const t of TYPES) query.append('types', t);
		const raw = await this.getJson<{ start: number; end: number | null; smartDetectTypes?: string[] }[]>(`events?${query}`);
		const now = Date.now();
		return {
			recordingStart: camera.stats?.video?.recordingStart ?? null,
			events: raw.map((e) => ({ start: e.start, end: e.end ?? now, types: e.smartDetectTypes ?? [] }))
		};
	}

	/**
	 * The camera's current picture as a JPEG (Protect makes 640x360, about 25 KB): what the cabin
	 * cameras' live tiles show, much cheaper over the cabin's mobile link than a frame from the stream.
	 */
	snapshot(name: string): Promise<Buffer> {
		let load = this.snapshots.get(name);
		if (!load) {
			load = cached(SNAPSHOT_TTL_MS, async () => readBody(await this.get(`cameras/${(await this.camera(name)).id}/snapshot?ts=${Date.now()}`), 2_000_000));
			this.snapshots.set(name, load);
		}
		return load();
	}
}

const loginSet = config.protectUser !== '' && config.protectPass !== '';

/** Each site's console; null when not configured (no login, or no cabin URL). */
export const consoles: Record<ProtectSite, ProtectConsole | null> = {
	home: loginSet ? new ProtectConsole('home', config.protectUrl, config.protectCameras, false) : null,
	cabin: loginSet && config.cabinProtectUrl ? new ProtectConsole('cabin', config.cabinProtectUrl, config.cabinProtectCameras, true) : null
};

/** The console of a route's `site` parameter, or null for an unknown or unconfigured site. */
export const consoleOf = (site: string): ProtectConsole | null => (site === 'home' || site === 'cabin' ? consoles[site] : null);

/** The Protect camera linked to a CAMERAS id (third field of *_PROTECT_CAMERAS), with its console. */
export function linkedCamera(id: string): { protect: ProtectConsole; name: string } | null {
	for (const protect of Object.values(consoles)) {
		const camera = protect?.configured.find((c) => c.stream === id);
		if (protect && camera) return { protect, name: camera.name };
	}
	return null;
}
