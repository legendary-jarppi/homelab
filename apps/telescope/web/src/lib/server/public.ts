// Public mode (D4): requests for PUBLIC_HOST (telescope.shillyshally.org through cloudflared, behind Cloudflare
// Access) may only read the gallery and the published items' pictures, details and star measurements. The
// tunnel routes only those paths too, but this is the check that counts.
import { config } from './config';
import { upstreamJson } from './telescope';
import type { Final, Upload } from '$lib/types';

/**
 * A request for the public host: its Host header or the forwarded host names it, or it came through
 * Cloudflare at all (cloudflared passes on client headers, so any one of them is enough to be public).
 */
export function isPublicRequest(request: Request): boolean {
	if (!config.publicHost) return false;
	const hosts = [request.headers.get('host'), request.headers.get('x-forwarded-host')].map((h) => h?.split(',')[0].trim().toLowerCase().replace(/:\d+$/, ''));
	return hosts.includes(config.publicHost) || request.headers.has('cf-connecting-ip');
}

/** How long the published ids are trusted before they are asked again. */
const PUBLISHED_TTL_MS = 10_000;

interface Published {
	at: number;
	finals: Set<string>;
	uploads: Set<string>;
}

let published: Published | null = null;
let pending: Promise<Published> | null = null;
/** Bumped by forgetPublished(): an answer asked for before a change is not kept. */
let generation = 0;

/** Ids of the published finals and uploads; nothing is published while the processor or service does not answer. */
export async function publishedIds(): Promise<Published> {
	if (published && Date.now() - published.at < PUBLISHED_TTL_MS) return published;
	const asked = generation;
	pending ??= Promise.all([upstreamJson<Final[]>('/api/finals', 'processor'), upstreamJson<Upload[]>('/api/uploads', 'telescope')])
		.then(([finals, uploads]): Published => {
			const fresh: Published = {
				at: Date.now(),
				finals: new Set((finals ?? []).filter((f) => f.published === true && f.status === 'done').map((f) => f.id)),
				uploads: new Set((uploads ?? []).filter((u) => u.published === true).map((u) => u.id))
			};
			if (asked === generation) published = fresh;
			return fresh;
		})
		.finally(() => {
			pending = null;
		});
	return pending;
}

/** After a publish, unpublish or delete through this app: ask again on the next public request. */
export function forgetPublished() {
	published = null;
	pending = null;
	generation++;
}

const GALLERY = /^\/gallery(?:\/[^/]+)?(?:\/__data\.json)?\/?$/;
const IMAGE_API = /^\/api\/images\/(final|upload)\/([^/]+)(?:\/star)?$/;
const FINAL_FILE = /^\/finals\/([^/]+)\/[^/]+\.(?:jpe?g|png)$/i;
const UPLOAD_FILE = /^\/uploads\/([^/]+?)(?:-small)?\.jpg$/;

function decode(segment: string): string | null {
	try {
		return decodeURIComponent(segment);
	} catch {
		return null;
	}
}

/**
 * What the public host may request: GET (and HEAD) of the gallery pages and their data, the app's built assets
 * and icon, and for published finals and uploads their details, star measurements and pictures (not the
 * FITS, TIFF, log or the upload's original file). Everything else is answered 404.
 */
export async function publicAllowed(method: string, pathname: string): Promise<boolean> {
	if (method !== 'GET' && method !== 'HEAD') return false;
	if (pathname.startsWith('/_app/') || pathname === '/favicon.svg' || GALLERY.test(pathname)) return true;
	let m: RegExpExecArray | null;
	if ((m = IMAGE_API.exec(pathname))) {
		const id = decode(m[2]);
		const ids = await publishedIds();
		return id !== null && (m[1] === 'final' ? ids.finals : ids.uploads).has(id);
	}
	if ((m = FINAL_FILE.exec(pathname))) {
		const id = decode(m[1]);
		return id !== null && (await publishedIds()).finals.has(id);
	}
	if ((m = UPLOAD_FILE.exec(pathname))) {
		const id = decode(m[1]);
		return id !== null && (await publishedIds()).uploads.has(id);
	}
	return false;
}
