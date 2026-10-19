import { error } from '@sveltejs/kit';
import { jsonBody, parseNights, proxyJson, TARGET } from '$lib/server/telescope';
import type { RequestHandler } from './$types';

/** D3: final stacks, newest first. */
export const GET: RequestHandler = () => proxyJson('/api/finals', {}, 10_000, 'processor');

/** Queue a final stack: `{ target, nights? }` (every night of the target without `nights`). */
export const POST: RequestHandler = async ({ request }) => {
	const body = await jsonBody(request);
	if (typeof body.target !== 'string' || !TARGET.test(body.target)) error(400, 'target must be an ASIAIR target name');
	const nights = parseNights(body.nights);
	return proxyJson('/api/finals', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ target: body.target, ...(nights ? { nights } : {}) }) }, 10_000, 'processor');
};
