import { error } from '@sveltejs/kit';
import { IMAGE, proxyImage } from '$lib/server/telescope';
import type { RequestHandler } from './$types';

/** An own upload's display JPEG, `<id>.jpg` (full size) or `<id>-small.jpg`; an id names one file for good. */
export const GET: RequestHandler = ({ params }) => {
	if (!IMAGE.test(params.file)) error(404, 'Not an upload picture');
	return proxyImage(`/uploads/${params.file}`, 'private, max-age=31536000, immutable');
};
