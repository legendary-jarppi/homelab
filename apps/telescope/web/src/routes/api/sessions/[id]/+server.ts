import { error } from '@sveltejs/kit';
import { ID, proxyJson } from '$lib/server/telescope';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ params }) => {
	if (!ID.test(params.id)) error(404, 'Not a session');
	return proxyJson(`/api/sessions/${params.id}`, {}, 15_000);
};
