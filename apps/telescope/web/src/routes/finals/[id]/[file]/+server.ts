import { error } from '@sveltejs/kit';
import { FILE, ID, proxyFile } from '$lib/server/telescope';
import type { RequestHandler } from './$types';

/** A final stack's output: previews (JPEG), the linear FITS, the processed TIFF. A final's files do not change once written. */
export const GET: RequestHandler = ({ params }) => {
	if (!ID.test(params.id) || !FILE.test(params.file)) error(404, 'Not a final output');
	return proxyFile(`/finals/${params.id}/${params.file}`, 'private, max-age=86400', 'processor');
};
