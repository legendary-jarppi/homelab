// BluOS players (Bluesound NODE) for the Music cards: now playing, volume, grouping, and control.
//
// Lenbrook's BluOS Custom Integration API v1.7: plain HTTP GETs on port 11000 answering XML, no login
// (anyone on the LAN can already do the same). One loop per player long-polls /Status (the API's
// recommended 100 s; it answers at once when anything changes), so a player sees the same few requests
// however many screens are open; the browser polls /api/music, answered from memory. A player off the
// network is retried every minute (the cabin's is often switched off for weeks).
//
// Volume cap (BLUOS_MAX_VOLUME): the dashboard never raises a player above it, and before it starts
// playback (play, a source, grouping) it lowers any player that would sound louder than that. The
// BluOS app and the players' own buttons are not limited.
import { config, type MusicPlayerConfig } from './config';
import type { MusicData, MusicPlayer } from '$lib/types';

const PORT = 11000;
/** Long-poll duration, seconds (the API recommends 100 and at least 10). */
const LONG_POLL_S = 100;
/** A plain request (status, command, image); undici gives up connecting after 10 s anyway. */
const REQUEST_MS = 10_000;
const OFFLINE_RETRY_MS = 60_000;
/** The API forbids two requests for the same resource less than a second apart. */
const MIN_GAP_MS = 1000;
/** What − and + change, in the players' 0–100 volume. */
const VOLUME_STEP = 2;
/** After a command, before reading the player back: playback starts and groups form asynchronously. */
const SETTLE_MS = 400;
const PLAYING = new Set(['play', 'stream', 'connecting']);

/** A playable source: `play` is the player's request path that starts it. */
interface Source {
	id: string;
	label: string;
	play: string;
}

/** What /Status said last. */
interface Now {
	state: string;
	title: string;
	artist: string;
	album: string;
	/** serviceName, or the input's name for Capture (HDMI ARC, Bluetooth). */
	service: string;
	/** As the player gives it: an absolute URL or a path on the player. */
	image: string | null;
	mute: boolean;
	sleep: number;
	/** Request paths for skip and back; null when the source cannot. */
	skip: string | null;
	back: string | null;
	syncStat: string;
	/** Presets' id: changes when presets are added or removed in the BluOS app. */
	prid: string;
}

/** What /SyncStatus said last: the player's own name, volume and group. */
interface Sync {
	name: string;
	volume: number;
	mute: boolean | null;
	leader: string | null;
	followers: string[];
}

interface PlayerState {
	config: MusicPlayerConfig;
	online: boolean;
	now: Now | null;
	sync: Sync | null;
	sources: Source[];
}

const players = new Map<string, PlayerState>(
	config.musicPlayers.map((c) => [c.host, { config: c, online: false, now: null, sync: null, sources: [] }])
);
let started = false;

export class MusicError extends Error {
	constructor(
		readonly status: number,
		message: string
	) {
		super(message);
	}
}

// --- XML: the players' answers are flat and small; a few patterns read them without a parser. ---

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decode = (s: string) =>
	s.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (m, e: string) =>
		e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : (ENTITIES[e] ?? m)
	);
/** The text of the first <tag>…</tag>; null when absent. */
function text(xml: string, tag: string): string | null {
	const m = xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([^<]*)</${tag}>`));
	return m ? decode(m[1]).trim() : null;
}
/** The attributes of every <tag …> (opening or empty element). */
function elements(xml: string, tag: string): Record<string, string>[] {
	return [...xml.matchAll(new RegExp(`<${tag}\\s[^>]*>`, 'g'))].map((m) =>
		Object.fromEntries([...m[0].matchAll(/([\w:-]+)="([^"]*)"/g)].map((a) => [a[1], decode(a[2])]))
	);
}

function parseStatus(xml: string): Now & { etag: string } {
	const actions = new Map(elements(xml, 'action').map((a) => [a.name, a.url ?? null]));
	// Without a stream URL the player plays its queue, where /Skip and /Back work; a stream (Spotify,
	// radio, an input) offers them as actions with a URL, or not at all.
	const queue = text(xml, 'streamUrl') === null;
	const service = text(xml, 'service') ?? '';
	return {
		etag: elements(xml, 'status')[0]?.etag ?? '',
		state: text(xml, 'state') ?? '',
		title: text(xml, 'title1') ?? text(xml, 'name') ?? '',
		artist: text(xml, 'title2') ?? text(xml, 'artist') ?? '',
		album: text(xml, 'title3') ?? text(xml, 'album') ?? '',
		service: service === 'Capture' ? (text(xml, 'title1') ?? 'Input') : (text(xml, 'serviceName') ?? service),
		image: text(xml, 'image') || text(xml, 'currentImage') || null,
		mute: text(xml, 'mute') === '1',
		sleep: Number(text(xml, 'sleep')) || 0,
		skip: actions.get('skip') ?? (queue ? '/Skip' : null),
		back: actions.get('back') ?? (queue ? '/Back' : null),
		syncStat: text(xml, 'syncStat') ?? '',
		prid: text(xml, 'prid') ?? ''
	};
}

function parseSync(xml: string): Sync {
	const root = elements(xml, 'SyncStatus')[0] ?? {};
	return {
		name: root.name ?? '',
		volume: Number(root.volume) || 0,
		mute: root.mute === undefined ? null : root.mute === '1',
		leader: text(xml, 'master'),
		followers: elements(xml, 'slave').flatMap((s) => (s.id ? [s.id] : []))
	};
}

// --- Talking to a player ---

async function get(host: string, path: string, timeoutMs = REQUEST_MS): Promise<string> {
	const response = await fetch(`http://${host}:${PORT}${path}`, { signal: AbortSignal.timeout(timeoutMs) });
	if (!response.ok) throw new Error(`${path.split('?')[0]}: HTTP ${response.status}`);
	return response.text();
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** The inputs and Spotify (top level of /Browse, the items it can play directly) and the BluOS presets. */
async function loadSources(host: string): Promise<Source[]> {
	const [browse, presets] = await Promise.all([get(host, '/Browse'), get(host, '/Presets')]);
	return [
		...elements(browse, 'item')
			.filter((item) => item.playURL && item.text)
			.map((item, i): Source => ({ id: `input:${i}`, label: item.text, play: item.playURL })),
		...elements(presets, 'preset')
			.filter((preset) => preset.id && preset.name)
			.map((preset): Source => ({ id: `preset:${preset.id}`, label: preset.name, play: `/Preset?id=${encodeURIComponent(preset.id)}` }))
	];
}

/** Takes a /Status answer in; reads /SyncStatus and the sources again when they may have changed. */
async function apply(p: PlayerState, statusXml: string, forceSync = false): Promise<string> {
	const { etag, ...now } = parseStatus(statusXml);
	const host = p.config.host;
	const previous = p.now;
	// A follower's /Status is a copy of its leader's, so its own volume and group need /SyncStatus each time.
	if (forceSync || !p.online || !p.sync || previous?.syncStat !== now.syncStat || p.sync.leader !== null) {
		p.sync = parseSync(await get(host, '/SyncStatus'));
	}
	if (!p.online || previous?.prid !== now.prid) p.sources = await loadSources(host);
	p.now = now;
	if (!p.online) console.log(`music ${host} (${p.sync.name}): online`);
	p.online = true;
	return etag;
}

/** Long-polls one player for as long as the server runs. */
async function follow(p: PlayerState): Promise<never> {
	const host = p.config.host;
	let etag = '';
	/** Logged as not answering since it was last online (or since the start): once, not every minute. */
	let reported = false;
	for (;;) {
		const started = Date.now();
		try {
			const statusXml = etag
				? await get(host, `/Status?timeout=${LONG_POLL_S}&etag=${encodeURIComponent(etag)}`, (LONG_POLL_S + 15) * 1000)
				: await get(host, '/Status');
			etag = await apply(p, statusXml);
			reported = false;
		} catch (e) {
			if (!reported) console.log(`music ${host}: not answering (${(e as Error).message}); trying every ${OFFLINE_RETRY_MS / 1000} s`);
			reported = true;
			p.online = false;
			etag = '';
			await sleep(OFFLINE_RETRY_MS);
			continue;
		}
		await sleep(Math.max(0, MIN_GAP_MS - (Date.now() - started)));
	}
}

/** Starts following every configured player (once; from the server's init hook). */
export function startMusic(): void {
	if (started) return;
	started = true;
	for (const p of players.values()) void follow(p);
}

// --- What the page gets ---

/** The player's image for the browser: its own files through /api/music/<id>/image (the browser may be away from home), others as they are. */
function imageUrl(p: PlayerState, image: string | null): string | null {
	if (!image) return null;
	const own = `http://${p.config.host}:${PORT}`;
	const path = image.startsWith('/') ? image : image.startsWith(own + '/') ? image.slice(own.length) : null;
	return path === null ? image : `/api/music/${encodeURIComponent(p.config.host)}/image?path=${encodeURIComponent(path)}`;
}

function toPlayer(p: PlayerState): MusicPlayer {
	const now = p.now;
	const sync = p.sync;
	const active = (s: Source) => !!now && PLAYING.has(now.state) && s.id.startsWith('input:') && s.label === now.service;
	return {
		id: p.config.host,
		name: sync?.name || p.config.label,
		site: p.config.site,
		online: p.online,
		state: now?.state ?? '',
		playing: !!now && PLAYING.has(now.state),
		title: now?.title ?? '',
		artist: now?.artist ?? '',
		album: now?.album ?? '',
		service: now?.service ?? '',
		image: imageUrl(p, now?.image ?? null),
		volume: sync?.volume ?? 0,
		mute: sync?.mute ?? now?.mute ?? false,
		canSkip: !!now?.skip,
		canBack: !!now?.back,
		sleep: now?.sleep ?? 0,
		sources: p.sources.map((s) => ({ id: s.id, label: s.label, active: active(s) })),
		leader: sync?.leader ?? null,
		followers: sync?.followers ?? []
	};
}

export function musicData(): MusicData {
	return { players: [...players.values()].map(toPlayer), maxVolume: config.musicMaxVolume, volumeStep: VOLUME_STEP };
}

// --- Commands ---

export type MusicCommand =
	| { action: 'play' | 'pause' | 'skip' | 'back' | 'sleep' | 'group' | 'ungroup' }
	| { action: 'volume'; step: 1 | -1 }
	| { action: 'mute'; mute: boolean }
	| { action: 'source'; source: string };

function parseCommand(body: unknown): MusicCommand {
	const b = (body ?? {}) as Record<string, unknown>;
	switch (b.action) {
		case 'play':
		case 'pause':
		case 'skip':
		case 'back':
		case 'sleep':
		case 'group':
		case 'ungroup':
			return { action: b.action };
		case 'volume':
			if (b.step === 1 || b.step === -1) return { action: 'volume', step: b.step };
			break;
		case 'mute':
			if (typeof b.mute === 'boolean') return { action: 'mute', mute: b.mute };
			break;
		case 'source':
			if (typeof b.source === 'string') return { action: 'source', source: b.source };
			break;
	}
	throw new MusicError(400, 'Unknown command');
}

/** Lowers the players louder than the cap to it (each on its own: tell_slaves=0 keeps a leader's change to itself). */
async function capVolume(group: PlayerState[]): Promise<void> {
	for (const p of group) {
		if ((p.sync?.volume ?? 0) > config.musicMaxVolume) await get(p.config.host, `/Volume?level=${config.musicMaxVolume}&tell_slaves=0`);
	}
}

/** The player and the players following it: what starting playback on it makes sound. */
const groupOf = (p: PlayerState) => [p, ...(p.sync?.followers ?? []).flatMap((id) => players.get(id) ?? [])];

/** Reads players back after a command, so the answer shows what they now report. */
async function refresh(group: PlayerState[]): Promise<void> {
	await sleep(SETTLE_MS);
	await Promise.all(
		group.map(async (p) => {
			try {
				await apply(p, await get(p.config.host, '/Status'), true);
			} catch {
				// The long-poll loop notices and marks it offline.
			}
		})
	);
}

export async function command(id: string, body: unknown): Promise<MusicData> {
	const p = players.get(id);
	if (!p) throw new MusicError(404, 'No such player');
	const c = parseCommand(body);
	if (!p.online || !p.now || !p.sync) throw new MusicError(409, `${p.sync?.name || p.config.label} is not on the network`);
	const host = p.config.host;
	const now = p.now;
	const sync = p.sync;
	const name = sync.name || p.config.label;
	// Everyone at the site whose state may change: the group forming or breaking, or just this group.
	let touched = groupOf(p);
	try {
		switch (c.action) {
			case 'play':
				await capVolume(groupOf(p));
				await get(host, '/Play');
				break;
			case 'pause':
				await get(host, '/Pause');
				break;
			case 'skip':
			case 'back': {
				const path = c.action === 'skip' ? now.skip : now.back;
				if (!path) throw new MusicError(409, `This source cannot ${c.action === 'skip' ? 'skip' : 'go back'}`);
				await get(host, path);
				break;
			}
			case 'volume': {
				const target = c.step > 0 ? Math.min(sync.volume + VOLUME_STEP, config.musicMaxVolume) : Math.max(sync.volume - VOLUME_STEP, 0);
				if (c.step > 0 && target <= sync.volume) throw new MusicError(409, `At the dashboard's maximum volume (${config.musicMaxVolume})`);
				await get(host, `/Volume?level=${target}&tell_slaves=0`);
				touched = [p];
				break;
			}
			case 'mute':
				await get(host, `/Volume?mute=${c.mute ? 1 : 0}&tell_slaves=0`);
				touched = [p];
				// Unmuting returns to the volume before the mute, which may be above the cap.
				if (!c.mute) {
					await refresh([p]);
					await capVolume([p]);
				}
				break;
			case 'source': {
				const source = p.sources.find((s) => s.id === c.source);
				if (!source) throw new MusicError(400, 'No such source on this player');
				await capVolume(groupOf(p));
				await get(host, source.play);
				break;
			}
			case 'sleep':
				// Each call moves to the next step: 15, 30, 45, 60, 90 minutes, off.
				await get(host, '/Sleep');
				break;
			case 'group': {
				if (sync.leader) throw new MusicError(409, `${name} already plays along with another player`);
				const joining = [...players.values()].filter(
					(o) => o !== p && o.config.site === p.config.site && o.online && !sync.followers.includes(o.config.host)
				);
				if (joining.length === 0) throw new MusicError(409, 'No other player here to group with');
				await capVolume([p, ...joining]);
				for (const o of joining) await get(host, `/AddSlave?slave=${encodeURIComponent(o.config.host)}&port=${PORT}`);
				touched = [p, ...joining];
				break;
			}
			case 'ungroup':
				for (const f of sync.followers) await get(host, `/RemoveSlave?slave=${encodeURIComponent(f)}&port=${PORT}`);
				break;
		}
	} catch (e) {
		if (e instanceof MusicError) throw e;
		throw new MusicError(502, `${name}: ${(e as Error).message}`);
	}
	await refresh(touched);
	return musicData();
}

/** A picture stored on the player (an input's icon, BluOS artwork), for players the browser cannot reach. */
export async function playerImage(id: string, path: string): Promise<Response> {
	const p = players.get(id);
	if (!p) throw new MusicError(404, 'No such player');
	// Paths on the player only (/images/…, /Artwork?…, /Sources/…), never another host.
	if (!/^\/[A-Za-z]/.test(path)) throw new MusicError(400, 'Not a path on the player');
	const url = path.startsWith('/Artwork') ? `${path}${path.includes('?') ? '&' : '?'}followRedirects=1` : path;
	try {
		const response = await fetch(`http://${p.config.host}:${PORT}${url}`, { signal: AbortSignal.timeout(REQUEST_MS) });
		if (!response.ok) throw new MusicError(response.status === 404 ? 404 : 502, `Image: HTTP ${response.status}`);
		return new Response(response.body, {
			headers: { 'content-type': response.headers.get('content-type') ?? 'image/png', 'cache-control': 'private, max-age=3600' }
		});
	} catch (e) {
		if (e instanceof MusicError) throw e;
		throw new MusicError(502, `Image: ${(e as Error).message}`);
	}
}
