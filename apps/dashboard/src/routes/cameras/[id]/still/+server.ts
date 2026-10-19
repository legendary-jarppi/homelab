import { error } from '@sveltejs/kit';
import { linkedCamera } from '$lib/server/protect';
import type { RequestHandler } from './$types';

/** A still from the camera's recording at `?ts=` (unix ms), 640x360: what the timeline shows while scrubbing. */
export const GET: RequestHandler = async ({ params, url }) => {
	const linked = linkedCamera(params.id);
	if (!linked) error(404, 'No recordings for this camera');
	const ts = Number(url.searchParams.get('ts'));
	if (!Number.isSafeInteger(ts) || ts > Date.now()) error(400, 'Bad ts');
	try {
		return new Response(new Uint8Array(await linked.protect.recordingStill(linked.name, ts)), {
			headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=86400' }
		});
	} catch (e) {
		console.error(`protect ${linked.protect.site} still ${linked.name} ${ts}:`, e instanceof Error ? e.message : e);
		error(502, 'Still unavailable');
	}
};
