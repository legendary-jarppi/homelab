import { error } from '@sveltejs/kit';
import { ID, proxyJson } from '$lib/server/telescope';
import type { RequestHandler } from './$types';

/**
 * Manual override of the automatic frame decision: `{ accepted: true | false }` puts a frame in or out of the
 * stack by hand, `{ accepted: null }` returns it to the automatic decision. The service restacks in the background.
 * JSON only: a cross-site form cannot send it, and a cross-site fetch with JSON needs a CORS preflight this app never grants.
 */
export const POST: RequestHandler = async ({ params, request }) => {
	if (!ID.test(params.id) || !ID.test(params.frameId)) error(404, 'Not a frame');
	if (!request.headers.get('content-type')?.startsWith('application/json')) error(415, 'JSON expected');
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		error(400, 'Invalid JSON');
	}
	const accepted = (body as { accepted?: unknown } | null)?.accepted;
	if (accepted !== true && accepted !== false && accepted !== null) error(400, 'accepted must be true, false or null');
	return proxyJson(`/api/sessions/${params.id}/frames/${params.frameId}`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ accepted })
	});
};
