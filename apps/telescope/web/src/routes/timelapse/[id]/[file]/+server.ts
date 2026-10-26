import { error } from '@sveltejs/kit';
import { ID, proxyFile } from '$lib/server/telescope';
import type { RequestHandler } from './$types';

/** B4: a timelapse as an animated WebP download, `frames.webp` or `stack.webp`. With ?v=<key> the URL names one version: cached for good. */
export const GET: RequestHandler = ({ params, url }) => {
	if (!ID.test(params.id) || !['frames.webp', 'stack.webp'].includes(params.file)) error(404, 'Not a timelapse');
	const version = url.searchParams.get('v');
	if (version !== null && !/^[0-9a-f]{12}$/.test(version)) error(404, 'Not a timelapse');
	return proxyFile(`/timelapse/${params.id}/${params.file}${version ? `?v=${version}` : ''}`, version ? 'private, max-age=31536000, immutable' : 'no-cache', 'telescope');
};
