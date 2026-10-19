import { error } from '@sveltejs/kit';
import { galleryPatch } from '$lib/server/gallery';
import { forgetPublished } from '$lib/server/public';
import { ID, jsonBody, proxyJson } from '$lib/server/telescope';
import type { RequestHandler } from './$types';

/** One own upload. */
export const GET: RequestHandler = ({ params }) => {
	if (!ID.test(params.id)) error(404, 'Not an upload');
	return proxyJson(`/api/uploads/${params.id}`);
};

/** Change an upload: `{ target?, title?, note?, published?, takenAt? }`, checked, then passed to the service. */
export const PUT: RequestHandler = async ({ params, request }) => {
	if (!ID.test(params.id)) error(404, 'Not an upload');
	const patch = galleryPatch(await jsonBody(request), true);
	const response = await proxyJson(`/api/uploads/${params.id}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(patch) });
	forgetPublished();
	return response;
};

/** Delete an upload and its files. */
export const DELETE: RequestHandler = async ({ params }) => {
	if (!ID.test(params.id)) error(404, 'Not an upload');
	const response = await proxyJson(`/api/uploads/${params.id}`, { method: 'DELETE' });
	forgetPublished();
	return response;
};
