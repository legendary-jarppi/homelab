// The telescope service and its processor (apps/telescope) behind this app's server routes: the browser
// never talks to them directly (they are cluster-internal). Ids are checked before they go into a URL.
import { error, isHttpError, json } from '@sveltejs/kit';
import { config } from './config';

/** Session and frame ids: URL-safe, no leading dot (so never "." or ".."). */
export const ID = /^[A-Za-z0-9_-][A-Za-z0-9_.-]{0,127}$/;
/** File names of the processor's outputs (`<id>.fits`, `preview.jpg`, `final-linear.fits` …). */
export const FILE = /^[A-Za-z0-9_-][A-Za-z0-9_.-]{0,127}$/;
/** An ASIAIR target name ("C 9", "NGC 7000 North America"): no control characters or slashes, no leading dot. */
export const TARGET = /^(?!\.)[^\x00-\x1f\x7f/\\]{1,128}$/;
/** A night, YYYY-MM-DD. */
export const NIGHT = /^\d{4}-\d{2}-\d{2}$/;

/** A JSON request body (JSON only: a cross-site form cannot send it, and a cross-site JSON fetch needs a CORS preflight that is never granted). */
export async function jsonBody(request: Request): Promise<Record<string, unknown>> {
	if (!request.headers.get('content-type')?.startsWith('application/json')) error(415, 'JSON expected');
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		error(400, 'Invalid JSON');
	}
	if (!body || typeof body !== 'object' || Array.isArray(body)) error(400, 'A JSON object expected');
	return Object.fromEntries(Object.entries(body));
}

/** `nights` from a body or query: YYYY-MM-DD strings, at most 400; undefined when absent. */
export function parseNights(value: unknown): string[] | undefined {
	if (value === undefined || value === null) return undefined;
	const list = typeof value === 'string' ? value.split(',').filter(Boolean) : value;
	if (!Array.isArray(list) || list.length > 400 || !list.every((n) => typeof n === 'string' && NIGHT.test(n))) error(400, 'nights must be YYYY-MM-DD dates');
	return list;
}

/** Preview file names: `<id>.jpg` or `<id>-small.jpg`. */
export const IMAGE = /^[A-Za-z0-9_-][A-Za-z0-9_.-]{0,127}\.jpg$/;

export type Upstream = 'telescope' | 'processor';

const NAMES: Record<Upstream, string> = { telescope: 'Telescope service', processor: 'Telescope processor' };

function base(upstream: Upstream): string {
	const url = upstream === 'telescope' ? config.telescopeUrl : config.processorUrl;
	if (!url) error(404, `${NAMES[upstream]} not configured`);
	return url;
}

/** Pass a JSON answer through (status and body as they are); 502 when the service does not answer. */
export async function proxyJson(path: string, init: RequestInit = {}, timeoutMs = 10_000, upstream: Upstream = 'telescope'): Promise<Response> {
	try {
		const response = await fetch(`${base(upstream)}${path}`, { ...init, signal: AbortSignal.timeout(timeoutMs) });
		const body = await response.text();
		// Errors may come as text/plain; the browser always gets JSON.
		if (!response.ok && !response.headers.get('content-type')?.includes('json')) return json({ message: body.slice(0, 500) || `HTTP ${response.status}` }, { status: response.status, headers: { 'cache-control': 'no-store' } });
		return new Response(body, { status: response.status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
	} catch (e) {
		if (isHttpError(e)) throw e;
		return json({ message: `${NAMES[upstream]} unavailable: ${(e as Error).message}` }, { status: 502 });
	}
}

/** Stream a JPEG preview through with the given cache policy. */
export function proxyImage(path: string, cacheControl: string, upstream: Upstream = 'telescope'): Promise<Response> {
	return proxyFile(path, cacheControl, upstream, 30_000);
}

/**
 * Stream a file through as it comes (no buffering: tar downloads have no length and run for minutes),
 * keeping its type, length and download name. The timeout covers the answer's start only.
 */
export async function proxyFile(path: string, cacheControl: string, upstream: Upstream, startTimeoutMs = 60_000): Promise<Response> {
	let response: Response;
	const abort = new AbortController();
	const timer = setTimeout(() => abort.abort(), startTimeoutMs);
	try {
		response = await fetch(`${base(upstream)}${path}`, { signal: abort.signal });
	} catch (e) {
		if (isHttpError(e)) throw e;
		error(502, `${NAMES[upstream]} unavailable`);
	} finally {
		clearTimeout(timer);
	}
	if (!response.ok || !response.body) error(response.status === 404 ? 404 : 502, response.status === 404 ? 'Not found' : 'File unavailable');
	const headers = new Headers({ 'content-type': response.headers.get('content-type') ?? 'application/octet-stream', 'cache-control': cacheControl });
	for (const name of ['content-length', 'content-disposition']) {
		const value = response.headers.get(name);
		if (value) headers.set(name, value);
	}
	return new Response(response.body, { headers });
}
