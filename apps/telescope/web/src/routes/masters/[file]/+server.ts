import { error } from '@sveltejs/kit';
import { FILE, proxyFile } from '$lib/server/telescope';
import type { RequestHandler } from './$types';

/** A calibration master, `<id>.fits`. */
export const GET: RequestHandler = ({ params }) => {
	if (!FILE.test(params.file) || !params.file.endsWith('.fits')) error(404, 'Not a master');
	return proxyFile(`/masters/${params.file}`, 'no-cache', 'processor');
};
