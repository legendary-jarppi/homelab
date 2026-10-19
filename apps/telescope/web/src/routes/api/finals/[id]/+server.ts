import { error } from '@sveltejs/kit';
import { ID, proxyJson } from '$lib/server/telescope';
import type { RequestHandler } from './$types';

/** One final stack with the tail of its log. */
export const GET: RequestHandler = ({ params }) => {
	if (!ID.test(params.id)) error(404, 'Not a final');
	return proxyJson(`/api/finals/${params.id}`, {}, 10_000, 'processor');
};
