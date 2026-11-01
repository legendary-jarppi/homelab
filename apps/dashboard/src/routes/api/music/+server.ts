import { error, json } from '@sveltejs/kit';
import { musicData } from '$lib/server/bluos';
import { config } from '$lib/server/config';
import type { RequestHandler } from './$types';

/** The BluOS players as last heard (the server long-polls them): the Music cards. */
export const GET: RequestHandler = () => {
	if (config.musicPlayers.length === 0) error(404, 'Music not configured');
	return json(musicData(), { headers: { 'Cache-Control': 'no-store' } });
};
