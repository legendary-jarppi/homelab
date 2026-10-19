import { error } from '@sveltejs/kit';
import { ID, proxyFile } from '$lib/server/telescope';
import type { RequestHandler } from './$types';

/** The file as uploaded (TIFF, FITS …), streamed through with its type and download name. */
export const GET: RequestHandler = ({ params }) => {
	if (!ID.test(params.id)) error(404, 'Not an upload');
	return proxyFile(`/uploads/${params.id}/original`, 'private, max-age=86400', 'telescope');
};
