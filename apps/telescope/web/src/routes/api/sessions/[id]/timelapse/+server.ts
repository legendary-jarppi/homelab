import { error } from '@sveltejs/kit';
import { ID, proxyJson } from '$lib/server/telescope';
import type { RequestHandler } from './$types';

/** B4: a session's timelapse (index of the frames and the growing stack, build state); asking for it starts a build when it is missing or out of date. */
export const GET: RequestHandler = ({ params }) => {
	if (!ID.test(params.id)) error(404, 'Not a session');
	return proxyJson(`/api/sessions/${params.id}/timelapse`);
};
