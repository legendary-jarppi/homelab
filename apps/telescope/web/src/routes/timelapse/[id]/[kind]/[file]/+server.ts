import { error } from '@sveltejs/kit';
import { ID, proxyImage } from '$lib/server/telescope';
import type { RequestHandler } from './$types';

/** B4: one timelapse picture, `<key>.jpg` (the hash of everything in it): cached for good. */
export const GET: RequestHandler = ({ params }) => {
	if (!ID.test(params.id) || !['frames', 'stack'].includes(params.kind) || !/^[0-9a-f]{12}\.jpg$/.test(params.file)) error(404, 'Not a timelapse picture');
	return proxyImage(`/timelapse/${params.id}/${params.kind}/${params.file}`, 'private, max-age=31536000, immutable');
};
