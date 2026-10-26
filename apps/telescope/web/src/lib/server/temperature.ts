// A5: the air temperature over a session, for the Focus card beside the focuser's own reading: the cabin's
// outdoor RuuviTag from Prometheus (apps/ruuvi) and Open-Meteo's hourly 2 m temperature at the site (forecast
// API for the last ~80 days, the historical forecast archive before, as for the wind). Both cached (cache.ts).
import { cached, fetchJson } from './cache';
import { config, type Site } from './config';
import type { Series, Sourced } from '$lib/types';

const MIN = 60_000;
const HOUR = 3_600_000;
/** The cabin's outdoor tag (apps/ruuvi TAGS names it). */
export const RUUVI_QUERY = 'ruuvi_temperature_celsius{name="Terassi"}';
/** About this many points per query_range, never closer than the gateway's 60 s. */
const RUUVI_POINTS = 300;
/** A window ending within this of now is still growing: refreshed every 2 min. */
const LIVE_S = 600;

/** The RuuviTag's temperature over [fromS, toS] (unix s); an empty series when the tag was not heard. */
export function ruuviTemperature(fromS: number, toS: number): Promise<Sourced<Series>> {
	const base = config.prometheusUrl;
	if (!base) return Promise.resolve({ data: null, error: 'PROMETHEUS_URL not set', fetchedAt: null });
	const live = toS > Date.now() / 1000 - LIVE_S;
	// A growing window has one cache entry per session start (its end is "now" at each refresh).
	const key = `prometheus ruuvi ${Math.round(fromS)} ${live ? 'live' : Math.round(toS)}`;
	return cached(key, live ? 2 * MIN : 24 * HOUR, live ? 30 * MIN : 7 * 24 * HOUR, async () => {
		const end = live ? Math.max(fromS + 60, Date.now() / 1000) : toS;
		const step = Math.max(60, Math.ceil((end - fromS) / RUUVI_POINTS));
		const url = new URL(`${base}/api/v1/query_range`);
		url.search = new URLSearchParams({ query: RUUVI_QUERY, start: String(fromS), end: String(end), step: String(step) }).toString();
		const body = await fetchJson<{ status: string; data: { result: { values: [number, string][] }[] } }>(url);
		if (body.status !== 'success') throw new Error(`Prometheus: ${body.status}`);
		const values = body.data.result[0]?.values ?? [];
		return values.map(([t, v]) => [t, Math.round(Number(v) * 100) / 100] as [number, number]).filter(([, v]) => Number.isFinite(v));
	});
}

/** Open-Meteo's hourly 2 m temperature at the site over [fromS, toS]; days that are over are cached a day. */
export function siteTemperature(site: Site, fromS: number, toS: number): Promise<Sourced<Series>> {
	const day = (s: number) => new Date(s * 1000).toISOString().slice(0, 10);
	const start = day(fromS);
	const end = day(toS);
	const today = day(Date.now() / 1000);
	const recent = Date.now() / 1000 - fromS < 80 * 86_400;
	return cached(`open-meteo temperature ${site.lat},${site.lon} ${start} ${end}`, end >= today ? 30 * MIN : 24 * HOUR, 7 * 24 * HOUR, async () => {
		const url = new URL(recent ? 'https://api.open-meteo.com/v1/forecast' : 'https://historical-forecast-api.open-meteo.com/v1/forecast');
		url.search = new URLSearchParams({
			latitude: String(site.lat),
			longitude: String(site.lon),
			hourly: 'temperature_2m',
			timeformat: 'unixtime',
			timezone: 'GMT',
			start_date: start,
			end_date: end
		}).toString();
		const h = (await fetchJson<{ hourly: { time: number[]; temperature_2m: (number | null)[] } }>(url)).hourly;
		return h.time.flatMap((t, i) => (h.temperature_2m[i] === null ? [] : [[t, h.temperature_2m[i]] as [number, number]]));
	});
}
