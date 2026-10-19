import { error } from '@sveltejs/kit';
import { config } from '$lib/server/config';
import { consoles } from '$lib/server/protect';
import type { RequestHandler } from './$types';

const jpeg = { 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-store' };

/**
 * A camera tile's picture: Protect's snapshot for cameras linked to a stream in *_PROTECT_CAMERAS (the
 * cabin's, over its mobile link), otherwise the latest keyframe from go2rtc, downscaled for tiles.
 */
export const GET: RequestHandler = async ({ params, url }) => {
	if (!config.cameras.some((c) => c.id === params.id)) error(404, 'Unknown camera');

	for (const protect of Object.values(consoles)) {
		const camera = protect?.configured.find((c) => c.stream === params.id);
		if (!protect || !camera) continue;
		try {
			return new Response(new Uint8Array(await protect.snapshot(camera.name)), { headers: jpeg });
		} catch (e) {
			console.error(`protect ${protect.site} snapshot ${camera.name}:`, e instanceof Error ? e.message : e);
			error(502, 'Camera unavailable');
		}
	}

	const width = Math.min(1920, Math.max(320, Number(url.searchParams.get('width')) || 960));
	const upstream = new URL('/api/frame.jpeg', config.go2rtcUrl);
	upstream.search = new URLSearchParams({ src: params.id, width: String(width) }).toString();
	const response = await fetch(upstream, { signal: AbortSignal.timeout(10_000) });
	if (!response.ok || !response.headers.get('content-type')?.startsWith('image/')) {
		error(502, 'Camera unavailable');
	}
	return new Response(response.body, { headers: jpeg });
};
