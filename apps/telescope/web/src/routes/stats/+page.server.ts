import { error } from '@sveltejs/kit';
import { CLEAR_PCT } from '$lib/server/conditions';
import { config } from '$lib/server/config';
import { era5Clouds } from '$lib/server/history';
import { upstreamJson } from '$lib/server/telescope';
import { nightNoon } from '$lib/sky';
import { CLEAR_NIGHT_HOURS, clearByMonth, clearNights, monthOf, monthsBetween, nightsBetween } from '$lib/stats';
import type { ClearMonth, ClearNight, GuideLogSummary, SessionSummary } from '$lib/types';
import type { PageServerLoad } from './$types';

/**
 * D6: the sessions (with the service's statistics fields), clear nights from ERA5 at the site from the month
 * of the first session to the last night that is over, and the PHD2 guide logs' RMS where the service has them.
 */
export const load: PageServerLoad = async () => {
	const sessions = await upstreamJson<SessionSummary[]>('/api/sessions', 'telescope');
	if (!sessions) error(502, 'Telescope service unavailable.');
	const site = config.site;
	const first = sessions.reduce<string | null>((min, s) => (min === null || s.night < min ? s.night : min), null);
	const lastNight = new Date(nightNoon(Date.now()) - 86_400_000).toISOString().slice(0, 10);
	const [era5, logs] = await Promise.all([
		site && first ? era5Clouds(site, `${monthOf(first)}-01`) : null,
		// D7's PHD2 guide log summaries; null while the service has none (404) or does not answer.
		upstreamJson<GuideLogSummary[]>('/api/guidelogs', 'telescope', 15_000)
	]);
	let clear: { nights: ClearNight[]; months: ClearMonth[]; error: string | null; until: number | null } | null = null;
	if (site && first && era5) {
		const data = era5.data;
		const months = monthsBetween(monthOf(first), monthOf(lastNight));
		const nights = data ? clearNights(data, nightsBetween(`${monthOf(first)}-01`, lastNight), site.lat, site.lon, new Set(sessions.map((s) => s.night)), CLEAR_PCT) : [];
		const known = data ? data.time.filter((_, i) => data.cloud[i] !== null) : [];
		clear = { nights, months: clearByMonth(nights, months), error: era5.error, until: known.length ? known[known.length - 1] : null };
	}
	return { sessions, clear, guideLogs: logs, clearPct: CLEAR_PCT, clearNightHours: CLEAR_NIGHT_HOURS };
};
