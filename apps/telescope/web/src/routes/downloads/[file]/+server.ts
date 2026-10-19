import { error } from '@sveltejs/kit';
import { parseNights, proxyFile, TARGET } from '$lib/server/telescope';
import type { RequestHandler } from './$types';

/**
 * Everything for processing a target by hand, as an uncompressed tar streamed from the processor:
 * `<target>.tar?nights=<n1,n2>&include=rejected`. Streamed through as it comes (no length, can take minutes).
 */
export const GET: RequestHandler = ({ params, url }) => {
	const target = params.file.endsWith('.tar') ? params.file.slice(0, -4) : '';
	if (!TARGET.test(target)) error(404, 'Not a download');
	const nights = parseNights(url.searchParams.get('nights'));
	const include = url.searchParams.get('include');
	if (include !== null && include !== 'rejected') error(400, 'include=rejected or nothing');
	const query = new URLSearchParams();
	if (nights?.length) query.set('nights', nights.join(','));
	if (include) query.set('include', include);
	const q = query.size ? `?${query}` : '';
	return proxyFile(`/downloads/${encodeURIComponent(target)}.tar${q}`, 'no-store', 'processor', 120_000);
};
