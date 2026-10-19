import { error, json } from '@sveltejs/kit';
import { consoleOf, WINDOW_HOURS } from '$lib/server/protect';
import type { ProtectData } from '$lib/types';
import type { RequestHandler } from './$types';

/** A Protect console's motion events of the last WINDOW_HOURS for the Cameras tab, newest first. */
export const GET: RequestHandler = async ({ params }) => {
	const protect = consoleOf(params.site);
	if (!protect) error(404, 'Protect not configured');
	try {
		const body: ProtectData = { site: protect.site, ...(await protect.data()), windowHours: WINDOW_HOURS };
		return json(body, { headers: { 'Cache-Control': 'no-store' } });
	} catch (e) {
		console.error(`protect ${protect.site} events:`, e instanceof Error ? e.message : e);
		error(502, 'Protect unavailable');
	}
};
