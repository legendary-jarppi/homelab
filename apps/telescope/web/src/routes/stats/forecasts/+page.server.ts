import { error } from '@sveltejs/kit';
import { config } from '$lib/server/config';
import { forecastReport } from '$lib/server/history';
import { upstreamJson } from '$lib/server/telescope';
import type { SessionSummary } from '$lib/types';
import type { PageServerLoad } from './$types';

/** C4: every session's hours scored against the models' cloud forecasts (cached per night and per session version). */
export const load: PageServerLoad = async () => {
	const sessions = await upstreamJson<SessionSummary[]>('/api/sessions', 'telescope');
	if (!sessions) error(502, 'Telescope service unavailable.');
	return { report: config.site ? await forecastReport(config.site, sessions) : null };
};
