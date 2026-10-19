import { error } from '@sveltejs/kit';
import { IMAGE, proxyImage } from '$lib/server/telescope';
import type { RequestHandler } from './$types';

/** A frame preview, `<frameId>.jpg` or `-small.jpg`. Frame ids change with the file, so the browser may keep it forever. */
export const GET: RequestHandler = ({ params }) => {
	if (!IMAGE.test(params.file)) error(404, 'Not a frame preview');
	return proxyImage(`/frames/${params.file}`, 'private, max-age=31536000, immutable');
};
