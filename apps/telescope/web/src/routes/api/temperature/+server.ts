import { error, json } from '@sveltejs/kit';
import { config } from '$lib/server/config';
import { ruuviTemperature, siteTemperature } from '$lib/server/temperature';
import type { SessionTemperatures } from '$lib/types';
import type { RequestHandler } from './$types';

const MAX_SPAN_S = 3 * 86_400;

/** A5: the cabin's outdoor RuuviTag and Open-Meteo's site temperature (°C) over ?from=&to= (unix s, at most 3 days): the session's Focus card. */
export const GET: RequestHandler = async ({ url }) => {
	const from = Number(url.searchParams.get('from'));
	const to = Number(url.searchParams.get('to'));
	if (!Number.isFinite(from) || !Number.isFinite(to) || to < from || to - from > MAX_SPAN_S || from < 1.5e9) error(400, 'from and to: unix seconds, at most 3 days apart');
	const [ruuvi, openMeteo] = await Promise.all([
		ruuviTemperature(from, to),
		config.site ? siteTemperature(config.site, from, to) : Promise.resolve({ data: null, error: 'Site not configured', fetchedAt: null } as const)
	]);
	const body: SessionTemperatures = { ruuvi, openMeteo };
	return json(body, { headers: { 'cache-control': 'no-store' } });
};
