// The telescope service (apps/telescope) behind this app's server routes: the browser never talks to it
// directly (it is cluster-internal). Ids are checked before they go into a URL.
import { error, json } from '@sveltejs/kit';
import { config } from './config';

/** Session and frame ids: URL-safe, no leading dot (so never "." or ".."). */
export const ID = /^[A-Za-z0-9_-][A-Za-z0-9_.-]{0,127}$/;
/** Preview file names: `<id>.jpg` or `<id>-small.jpg`. */
export const IMAGE = /^[A-Za-z0-9_-][A-Za-z0-9_.-]{0,127}\.jpg$/;

function base(): string {
	if (!config.telescopeUrl) error(404, 'Telescope not configured');
	return config.telescopeUrl;
}

/** Pass a JSON answer through (status and body as they are); 502 when the service does not answer. */
export async function proxyJson(path: string, init: RequestInit = {}, timeoutMs = 10_000): Promise<Response> {
	try {
		const response = await fetch(`${base()}${path}`, { ...init, signal: AbortSignal.timeout(timeoutMs) });
		return new Response(await response.text(), { status: response.status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
	} catch (e) {
		if ((e as { status?: number }).status) throw e;
		return json({ message: `Telescope service unavailable: ${(e as Error).message}` }, { status: 502 });
	}
}

/** Stream a JPEG preview through with the given cache policy. */
export async function proxyImage(path: string, cacheControl: string): Promise<Response> {
	let response: Response;
	try {
		response = await fetch(`${base()}${path}`, { signal: AbortSignal.timeout(30_000) });
	} catch {
		error(502, 'Telescope service unavailable');
	}
	if (!response.ok || !response.body) error(response.status === 404 ? 404 : 502, 'Image unavailable');
	const headers = new Headers({ 'content-type': 'image/jpeg', 'cache-control': cacheControl });
	const length = response.headers.get('content-length');
	if (length) headers.set('content-length', length);
	return new Response(response.body, { headers });
}
