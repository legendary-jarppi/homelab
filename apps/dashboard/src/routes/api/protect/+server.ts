import { error, json } from '@sveltejs/kit';
import { config } from '$lib/server/config';
import { protectData, WINDOW_HOURS } from '$lib/server/protect';
import type { ProtectData } from '$lib/types';
import type { RequestHandler } from './$types';

/** UniFi Protect's motion events of the last WINDOW_HOURS for the Cameras tab, newest first. */
export const GET: RequestHandler = async () => {
	if (!config.protectUser || !config.protectPass) error(404, 'Protect not configured');
	try {
		const body: ProtectData = { ...(await protectData()), windowHours: WINDOW_HOURS };
		return json(body, { headers: { 'Cache-Control': 'no-store' } });
	} catch (e) {
		console.error('protect events:', e instanceof Error ? e.message : e);
		error(502, 'Protect unavailable');
	}
};
