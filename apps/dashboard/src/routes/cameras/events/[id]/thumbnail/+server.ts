import { error } from '@sveltejs/kit';
import { config } from '$lib/server/config';
import { isEventId, thumbnail } from '$lib/server/protect';
import type { RequestHandler } from './$types';

/** A Protect motion event's thumbnail; it never changes once the event has ended. */
export const GET: RequestHandler = async ({ params }) => {
	if (!config.protectUser || !isEventId(params.id)) error(404, 'Unknown event');
	try {
		const jpeg = await thumbnail(params.id);
		return new Response(new Uint8Array(jpeg), {
			headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=604800, immutable' }
		});
	} catch (e) {
		console.error(`protect thumbnail ${params.id}:`, e instanceof Error ? e.message : e);
		error(502, 'Thumbnail unavailable');
	}
};
