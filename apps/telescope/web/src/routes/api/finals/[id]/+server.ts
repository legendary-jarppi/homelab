import { error } from '@sveltejs/kit';
import { galleryPatch } from '$lib/server/gallery';
import { forgetPublished } from '$lib/server/public';
import { ID, jsonBody, proxyJson } from '$lib/server/telescope';
import type { RequestHandler } from './$types';

/** One final stack with the tail of its log. */
export const GET: RequestHandler = ({ params }) => {
	if (!ID.test(params.id)) error(404, 'Not a final');
	return proxyJson(`/api/finals/${params.id}`, {}, 10_000, 'processor');
};

/** D4: publish a final in the gallery, or give it a title and note: `{ published?, title?, note? }`. */
export const PUT: RequestHandler = async ({ params, request }) => {
	if (!ID.test(params.id)) error(404, 'Not a final');
	const patch = galleryPatch(await jsonBody(request), false);
	const response = await proxyJson(`/api/finals/${params.id}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(patch) }, 10_000, 'processor');
	forgetPublished();
	return response;
};
