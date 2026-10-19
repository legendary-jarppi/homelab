import { error, json } from '@sveltejs/kit';
import { config } from '$lib/server/config';
import { wind } from '$lib/server/conditions';
import type { RequestHandler } from './$types';

const MAX_SPAN_S = 3 * 86_400;

/** Hourly wind and gusts (m/s) at the site over ?from=&to= (unix s, at most 3 days): beside the guiding graph. */
export const GET: RequestHandler = async ({ url }) => {
	if (!config.site) error(404, 'Site not configured');
	const from = Number(url.searchParams.get('from'));
	const to = Number(url.searchParams.get('to'));
	if (!Number.isFinite(from) || !Number.isFinite(to) || to < from || to - from > MAX_SPAN_S || from < 1.5e9) error(400, 'from and to: unix seconds, at most 3 days apart');
	return json(await wind(config.site, from, to), { headers: { 'cache-control': 'no-store' } });
};
