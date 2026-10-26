import { error } from '@sveltejs/kit';
import { ID, proxyJson } from '$lib/server/telescope';
import type { RequestHandler } from './$types';

/** A6: tilt and backfocus from the median of the session's best accepted frames; the first request measures up to five frames (~4 s). */
export const GET: RequestHandler = ({ params }) => {
	if (!ID.test(params.id)) error(404, 'Not a session');
	return proxyJson(`/api/sessions/${params.id}/inspect`, {}, 60_000);
};
