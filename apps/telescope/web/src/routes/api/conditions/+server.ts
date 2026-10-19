import { error, json } from '@sveltejs/kit';
import { config } from '$lib/server/config';
import { conditions } from '$lib/server/conditions';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => {
	if (!config.site) error(404, 'Site not configured');
	return json(await conditions(config.site), { headers: { 'cache-control': 'no-store' } });
};
