import { error } from '@sveltejs/kit';
import { config } from '$lib/server/config';
import type { RequestHandler } from './$types';

/** `<id>.jpg` (about 1500 px) or `<id>-small.jpg` (about 300 px); ids are content hashes. */
const FILE = /^[a-f0-9]{8,64}(-small)?\.jpg$/;

/** One frame preview, streamed from apps/telescope. Content-addressed, so the browser may keep it forever. */
export const GET: RequestHandler = async ({ params }) => {
	if (!config.telescopeUrl) error(404, 'Telescope not configured');
	if (!FILE.test(params.file)) error(404, 'Not a frame preview');
	let response: Response;
	try {
		response = await fetch(`${config.telescopeUrl}/frames/${params.file}`, { signal: AbortSignal.timeout(30_000) });
	} catch {
		error(502, 'Telescope service unavailable');
	}
	if (!response.ok || !response.body) error(response.status === 404 ? 404 : 502, 'Frame unavailable');
	const headers = new Headers({ 'content-type': 'image/jpeg', 'cache-control': 'private, max-age=31536000, immutable' });
	const length = response.headers.get('content-length');
	if (length) headers.set('content-length', length);
	return new Response(response.body, { headers });
};
