import { error } from '@sveltejs/kit';
import { config } from '$lib/server/config';
import type { RequestHandler } from './$types';

/** Response headers passed through from apps/cabin-camera (Range responses need all of them). */
const PASS = ['content-type', 'content-length', 'content-range', 'accept-ranges', 'cache-control'];

/**
 * One cabin picture or clip, streamed from apps/cabin-camera (which serves only known media types under
 * its upload root). Range requests are forwarded: Safari plays video only through them.
 */
export const GET: RequestHandler = async ({ params, request }) => {
	if (!config.cabinCameraUrl) error(404, 'Cabin camera not configured');
	const path = params.path.split('/').map(encodeURIComponent).join('/');
	const range = request.headers.get('range');
	const response = await fetch(new URL(`/snapshots/${path}`, config.cabinCameraUrl), {
		headers: range ? { range } : {},
		signal: AbortSignal.timeout(60_000)
	});
	if (response.status === 416) return new Response(null, { status: 416, headers: { 'content-range': response.headers.get('content-range') ?? '' } });
	if (!response.ok || !response.body) error(response.status === 404 ? 404 : 502, 'Snapshot unavailable');
	const headers = new Headers();
	for (const name of PASS) {
		const value = response.headers.get(name);
		if (value) headers.set(name, value);
	}
	return new Response(response.body, { status: response.status, headers });
};
