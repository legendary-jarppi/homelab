import { error } from '@sveltejs/kit';
import { IMAGE, proxyImage } from '$lib/server/telescope';
import type { RequestHandler } from './$types';

/** A session's stack preview, `<sessionId>.jpg` (~1504 px) or `-small.jpg` (~300 px). With ?v=<imageId> the URL names one version: cached for good. */
export const GET: RequestHandler = ({ params, url }) => {
	if (!IMAGE.test(params.file)) error(404, 'Not a stack preview');
	const version = url.searchParams.get('v');
	const query = version ? `?v=${encodeURIComponent(version)}` : '';
	return proxyImage(`/stacks/${params.file}${query}`, version ? 'private, max-age=31536000, immutable' : 'no-cache');
};
