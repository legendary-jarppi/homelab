import { error } from '@sveltejs/kit';
import { ID, proxyJson } from '$lib/server/telescope';
import type { RequestHandler } from './$types';

/** B1: an image's details for the viewer (full-resolution URL, plate solve, histogram): a session's stack and an own upload from the service, a final from the processor. */
export const GET: RequestHandler = ({ params }) => {
	if (!['stack', 'final', 'upload'].includes(params.kind) || !ID.test(params.id)) error(404, 'Not an image');
	return proxyJson(`/api/images/${params.kind}/${params.id}`, {}, 15_000, params.kind === 'final' ? 'processor' : 'telescope');
};
