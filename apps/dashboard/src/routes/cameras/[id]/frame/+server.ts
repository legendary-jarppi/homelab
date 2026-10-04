import { error } from '@sveltejs/kit';
import { config } from '$lib/server/config';
import type { RequestHandler } from './$types';

/** Snapshot proxy: latest keyframe from go2rtc, downscaled for tiles. */
export const GET: RequestHandler = async ({ params, url }) => {
	if (!config.cameras.some((c) => c.id === params.id)) error(404, 'Unknown camera');
	const width = Math.min(1920, Math.max(320, Number(url.searchParams.get('width')) || 960));

	const upstream = new URL('/api/frame.jpeg', config.go2rtcUrl);
	upstream.search = new URLSearchParams({ src: params.id, width: String(width) }).toString();
	const response = await fetch(upstream, { signal: AbortSignal.timeout(10_000) });
	if (!response.ok || !response.headers.get('content-type')?.startsWith('image/')) {
		error(502, 'Camera unavailable');
	}
	return new Response(response.body, {
		headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-store' }
	});
};
