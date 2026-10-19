import { error, json } from '@sveltejs/kit';
import { linkedCamera } from '$lib/server/protect';
import type { CameraTimeline } from '$lib/types';
import type { RequestHandler } from './$types';

/** The longest window one request may cover. */
const MAX_SPAN_MS = 7 * 86_400_000;

/** The camera's events between `?start=` and `?end=` (unix ms) and its oldest recording, for the viewer's timeline. */
export const GET: RequestHandler = async ({ params, url }) => {
	const linked = linkedCamera(params.id);
	if (!linked) error(404, 'No recordings for this camera');
	const start = Number(url.searchParams.get('start'));
	const end = Number(url.searchParams.get('end'));
	if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= end || end - start > MAX_SPAN_MS) error(400, 'Bad window');
	try {
		const body: CameraTimeline = await linked.protect.timeline(linked.name, start, end);
		return json(body, { headers: { 'Cache-Control': 'no-store' } });
	} catch (e) {
		console.error(`protect ${linked.protect.site} timeline ${linked.name}:`, e instanceof Error ? e.message : e);
		error(502, 'Timeline unavailable');
	}
};
