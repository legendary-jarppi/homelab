import { error } from '@sveltejs/kit';
import { KEY } from '$lib/goals';
import { jsonBody, proxyJson } from '$lib/server/telescope';
import type { RequestHandler } from './$types';

/**
 * Set a target's goal, wishlist mark or note: `{ goalHours?, wishlist?, note? }`, null clears a field, an omitted
 * one stays. Checked here, then passed to the service (which deletes the entry when everything is cleared).
 */
export const PUT: RequestHandler = async ({ params, request }) => {
	if (!KEY.test(params.key)) error(404, 'Not a target key');
	const body = await jsonBody(request);
	const patch: Record<string, unknown> = {};
	for (const [field, value] of Object.entries(body)) {
		if (field === 'goalHours') {
			if (value !== null && (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > 1000)) error(400, 'goalHours must be a number of hours (0–1000) or null');
		} else if (field === 'wishlist') {
			if (value !== null && typeof value !== 'boolean') error(400, 'wishlist must be true, false or null');
		} else if (field === 'note') {
			if (value !== null && (typeof value !== 'string' || value.length > 500)) error(400, 'note must be text (at most 500 characters) or null');
		} else error(400, `Unknown field ${field}`);
		patch[field] = value;
	}
	return proxyJson(`/api/targets/${encodeURIComponent(params.key)}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(patch) });
};
