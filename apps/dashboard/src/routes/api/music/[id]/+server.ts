import { json } from '@sveltejs/kit';
import { command, MusicError } from '$lib/server/bluos';
import type { RequestHandler } from './$types';

/**
 * A command to a player, JSON { action: play | pause | skip | back | sleep | group | ungroup }, { action: 'volume', step: 1 | -1 },
 * { action: 'mute', mute }, { action: 'source', source }. Answers every player as they now report (GET /api/music's shape);
 * an error as { message }.
 */
export const POST: RequestHandler = async ({ params, request }) => {
	try {
		return json(await command(params.id, await request.json().catch(() => null)), { headers: { 'Cache-Control': 'no-store' } });
	} catch (e) {
		if (!(e instanceof MusicError)) throw e;
		if (e.status >= 500) console.error(`music ${params.id}: ${e.message}`);
		return json({ message: e.message }, { status: e.status });
	}
};
