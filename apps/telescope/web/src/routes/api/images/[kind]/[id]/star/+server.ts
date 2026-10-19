import { error } from '@sveltejs/kit';
import { ID, proxyJson } from '$lib/server/telescope';
import type { RequestHandler } from './$types';

/** B1: the brightest star within ~12 px of `x`, `y` (display pixels) measured on the image's linear data. */
export const GET: RequestHandler = ({ params, url }) => {
	if (!['stack', 'final', 'upload'].includes(params.kind) || !ID.test(params.id)) error(404, 'Not an image');
	const x = Number(url.searchParams.get('x'));
	const y = Number(url.searchParams.get('y'));
	if (!url.searchParams.has('x') || !url.searchParams.has('y') || !Number.isFinite(x) || !Number.isFinite(y) || x < -1 || y < -1 || x > 100_000 || y > 100_000) error(400, 'x and y must be pixel coordinates');
	return proxyJson(`/api/images/${params.kind}/${params.id}/star?x=${x}&y=${y}`, {}, 15_000, params.kind === 'final' ? 'processor' : 'telescope');
};
