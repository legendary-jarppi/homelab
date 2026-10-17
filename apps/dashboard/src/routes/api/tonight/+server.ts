import { error, json } from '@sveltejs/kit';
import { config } from '$lib/server/config';
import { tonight } from '$lib/server/tonight';
import type { RequestHandler } from './$types';

/** Darkness, moon and clouds tonight at the telescope site (TELESCOPE_SITE); the forecast may be missing, the rest is computed. */
export const GET: RequestHandler = async () => {
	if (!config.telescopeSite) error(404, 'Telescope site not configured');
	return json(await tonight(config.telescopeSite), { headers: { 'Cache-Control': 'no-store' } });
};
