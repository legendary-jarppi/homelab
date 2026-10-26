import { error } from '@sveltejs/kit';
import { ID, proxyJson } from '$lib/server/telescope';
import type { RequestHandler } from './$types';

/** A6: one frame's tilt and backfocus inspection (3×3 grid, verdict, crop positions), measured from the archived FITS on first request (~1 s). */
export const GET: RequestHandler = ({ params }) => {
	if (!ID.test(params.id) || !ID.test(params.frameId)) error(404, 'Not a frame');
	return proxyJson(`/api/sessions/${params.id}/frames/${params.frameId}/inspect`, {}, 60_000);
};
