// Conditions at the site (C2, C3): Open-Meteo (weather and clouds by height from several models),
// 7Timer ASTRO (seeing, transparency), NOAA SWPC (planetary Kp, OVATION aurora). Each source is cached
// on its own (cache.ts) and may fail without taking the others down; darkness and the moon are computed.
import { cached, fetchJson } from './cache';
import type { Site } from './config';
import { moonAltitude, nightNoon, sky as nightSky } from '$lib/sky';
import type { Aurora, Conditions, KpPoint, ModelClouds, SeeingPoint, Sky, Sourced, WeatherHour, WindPoint } from '$lib/types';

const HOUR = 3_600_000;
const MIN = 60_000;
/** Cloud cover at or under this (%) counts as clear. */
export const CLEAR_PCT = 30;
/** Air within this many degrees of the dew point: dew likely on the optics. */
export const DEW_MARGIN_C = 2;
/** Gusts above this (m/s) shake a small refractor on an EQ mount. */
export const GUSTY_MS = 8;
/** OVATION probability (%) from which aurora is worth a look (and brightens the northern sky in frames). */
export const AURORA_PCT = 10;

/** Cloud models side by side; Open-Meteo answers null where a model does not reach (MET Nordic: Nordics, ~2.5 days). */
export const MODELS = [
	{ id: 'ecmwf_ifs025', label: 'ECMWF' },
	{ id: 'icon_seamless', label: 'ICON (DWD)' },
	{ id: 'gfs_seamless', label: 'GFS (NOAA)' },
	{ id: 'metno_seamless', label: 'MET Nordic' }
];

type Column = (number | null)[];

/** Open-Meteo hourly, best-match model: from yesterday to three days ahead, cached 30 min. */
export function weather(site: Site): Promise<Sourced<WeatherHour[]>> {
	return cached(`open-meteo weather ${site.lat},${site.lon}`, 30 * MIN, 3 * HOUR, async () => {
		const url = new URL('https://api.open-meteo.com/v1/forecast');
		url.search = new URLSearchParams({
			latitude: String(site.lat),
			longitude: String(site.lon),
			hourly: 'cloud_cover,temperature_2m,dew_point_2m,relative_humidity_2m,wind_speed_10m,wind_gusts_10m',
			wind_speed_unit: 'ms',
			timeformat: 'unixtime',
			timezone: 'GMT',
			past_days: '1',
			forecast_days: '3'
		}).toString();
		const body = await fetchJson<{ hourly: { time: number[] } & Record<string, Column> }>(url);
		const h = body.hourly;
		return h.time.map((t, i) => ({
			time: t * 1000,
			cloud: h.cloud_cover[i],
			temperature: h.temperature_2m[i],
			dewPoint: h.dew_point_2m[i],
			humidity: h.relative_humidity_2m[i],
			wind: h.wind_speed_10m[i],
			gusts: h.wind_gusts_10m[i]
		}));
	});
}

/** Wind over a past or current session (unix s), hourly; days that are over are cached a day. */
export function wind(site: Site, fromS: number, toS: number): Promise<Sourced<WindPoint[]>> {
	const day = (s: number) => new Date(s * 1000).toISOString().slice(0, 10);
	const start = day(fromS);
	const end = day(toS);
	const today = day(Date.now() / 1000);
	// The forecast API has about three months back; older nights come from the historical forecast archive.
	const recent = Date.now() / 1000 - fromS < 80 * 86_400;
	return cached(`open-meteo wind ${site.lat},${site.lon} ${start} ${end}`, end >= today ? 30 * MIN : 24 * HOUR, 7 * 24 * HOUR, async () => {
		const url = new URL(recent ? 'https://api.open-meteo.com/v1/forecast' : 'https://historical-forecast-api.open-meteo.com/v1/forecast');
		url.search = new URLSearchParams({
			latitude: String(site.lat),
			longitude: String(site.lon),
			hourly: 'wind_speed_10m,wind_gusts_10m',
			wind_speed_unit: 'ms',
			timeformat: 'unixtime',
			timezone: 'GMT',
			start_date: start,
			end_date: end
		}).toString();
		const h = (await fetchJson<{ hourly: { time: number[]; wind_speed_10m: Column; wind_gusts_10m: Column } }>(url)).hourly;
		return h.time.map((t, i) => ({ time: t, wind: h.wind_speed_10m[i], gusts: h.wind_gusts_10m[i] }));
	});
}

/** Low, mid and high cloud from each model, three days ahead, cached 30 min. */
export function models(site: Site): Promise<Sourced<{ time: number[]; models: ModelClouds[] }>> {
	return cached(`open-meteo models ${site.lat},${site.lon}`, 30 * MIN, 3 * HOUR, async () => {
		const url = new URL('https://api.open-meteo.com/v1/forecast');
		url.search = new URLSearchParams({
			latitude: String(site.lat),
			longitude: String(site.lon),
			hourly: 'cloud_cover,cloud_cover_low,cloud_cover_mid,cloud_cover_high',
			models: MODELS.map((m) => m.id).join(','),
			timeformat: 'unixtime',
			timezone: 'GMT',
			past_days: '1',
			forecast_days: '3'
		}).toString();
		const h = (await fetchJson<{ hourly: { time: number[] } & Record<string, Column | undefined> }>(url, 15_000)).hourly;
		const column = (name: string, model: string) => h[`${name}_${model}`] ?? h.time.map(() => null);
		return {
			time: h.time.map((t) => t * 1000),
			models: MODELS.map((m) => ({
				id: m.id,
				label: m.label,
				total: column('cloud_cover', m.id),
				low: column('cloud_cover_low', m.id),
				mid: column('cloud_cover_mid', m.id),
				high: column('cloud_cover_high', m.id)
			}))
		};
	});
}

/** 7Timer ASTRO: three-hourly seeing, transparency and cloud for three days, cached an hour (new runs every 6 h). */
function seeing(site: Site): Promise<Sourced<SeeingPoint[]>> {
	return cached(`7timer ${site.lat},${site.lon}`, HOUR, 12 * HOUR, async () => {
		const url = new URL('https://www.7timer.info/bin/astro.php');
		url.search = new URLSearchParams({ lon: String(site.lon), lat: String(site.lat), ac: '0', unit: 'metric', output: 'json', tzshift: '0' }).toString();
		const body = await fetchJson<{ init: string; dataseries: { timepoint: number; seeing: number; transparency: number; cloudcover: number }[] }>(url, 15_000);
		const m = /^(\d{4})(\d{2})(\d{2})(\d{2})$/.exec(body.init);
		if (!m) throw new Error(`7timer: unexpected init ${body.init}`);
		const init = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]));
		// -9999 marks a missing value.
		const value = (v: number) => (v > 0 ? v : null);
		return body.dataseries.map((d) => ({ time: init + d.timepoint * HOUR, seeing: value(d.seeing), transparency: value(d.transparency), cloud: value(d.cloudcover) }));
	});
}

/**
 * Planetary Kp per 3 h: observed and estimated for the past week, predicted for three days; "now" is the newest
 * observed or estimated value. (The 1-minute estimate, json/planetary_k_index_1m.json, said 0.0 on 2026-10-19
 * while the 3-hour product had 4.3 for the same hours, so it is not used.) Cached 15 min.
 */
function kp(): Promise<Sourced<{ now: number | null; nowAt: number | null; points: KpPoint[] }>> {
	return cached('swpc kp', 15 * MIN, 6 * HOUR, async () => {
		const forecast = await fetchJson<{ time_tag: string; kp: number; observed: string }[]>('https://services.swpc.noaa.gov/products/noaa-planetary-k-index-forecast.json');
		const points = forecast
			.filter((r) => typeof r.kp === 'number')
			.map((r) => ({ time: Date.parse(r.time_tag.endsWith('Z') ? r.time_tag : `${r.time_tag}Z`), kp: r.kp, kind: r.observed }));
		const latest = points.filter((p) => p.kind !== 'predicted' && p.time <= Date.now()).at(-1) ?? null;
		return { now: latest?.kp ?? null, nowAt: latest?.time ?? null, points };
	});
}

/** OVATION aurora nowcast (~30–90 min ahead) at the site's grid point and to the north of it, cached 10 min. */
function aurora(site: Site): Promise<Sourced<Aurora>> {
	return cached(`swpc ovation ${site.lat},${site.lon}`, 10 * MIN, 2 * HOUR, async () => {
		const body = await fetchJson<{ 'Observation Time': string; 'Forecast Time': string; coordinates: [number, number, number][] }>(
			'https://services.swpc.noaa.gov/json/ovation_aurora_latest.json',
			20_000
		);
		// 1° grid, longitudes 0…359.
		const lon = ((Math.round(site.lon) % 360) + 360) % 360;
		const lat = Math.round(site.lat);
		let probability = 0;
		let north = 0;
		for (const [x, y, p] of body.coordinates) {
			if (x !== lon) continue;
			if (y === lat) probability = p;
			// Aurora at ~110 km is in sight to about 1000 km (9° of latitude) away, low in the north.
			if (y > lat && y <= lat + 9) north = Math.max(north, p);
		}
		return { probability, northProbability: north, observedAt: Date.parse(body['Observation Time']) || null, forecastAt: Date.parse(body['Forecast Time']) || null };
	});
}

const clock = (ms: number) => new Date(ms).toLocaleTimeString('en-GB', { timeZone: 'Europe/Helsinki', hour: '2-digit', minute: '2-digit' });

/** Seeing class (7Timer 1…8) as arcsec. */
export const SEEING_ARCSEC = ['', '< 0.5″', '0.5–0.75″', '0.75–1″', '1–1.25″', '1.25–1.5″', '1.5–2″', '2–2.5″', '> 2.5″'];

/** One line for the night: the longest clear run in darkness (and how many models agree), moon, dew, wind, seeing. */
function verdict(sky: Sky, hours: WeatherHour[] | null, clouds: { time: number[]; models: ModelClouds[] } | null, seeingPoints: SeeingPoint[] | null): string {
	const dark = sky.astronomical ?? sky.nautical;
	const parts: string[] = [];
	if (!dark) parts.push(`No darkness tonight (sun lowest ${sky.sunLowest.toFixed(0)}°)`);
	const from = dark?.start ?? sky.sunset ?? sky.noon + 6 * HOUR;
	const to = dark?.end ?? sky.sunrise ?? sky.nextNoon - 6 * HOUR;
	const inNight = (t: number) => t + HOUR > from && t < to;
	if (hours) {
		const night = hours.filter((h) => inNight(h.time));
		let best: [number, number] | null = null;
		let start: number | null = null;
		for (const h of night) {
			if (h.cloud !== null && h.cloud <= CLEAR_PCT) start ??= h.time;
			else start = null;
			if (start !== null && (!best || h.time + HOUR - start > best[1] - best[0])) best = [start, h.time + HOUR];
		}
		if (best) {
			const [a, b] = [Math.max(best[0], from), Math.min(best[1], to)];
			parts.push(`Clear ${clock(a)}–${clock(b)} (${((b - a) / HOUR).toFixed(1)} h)`);
		} else if (night.length) parts.push('Cloudy all night');
		if (clouds) {
			const indices = clouds.time.map((t, i) => (inNight(t) ? i : -1)).filter((i) => i >= 0);
			const answering = clouds.models.filter((m) => indices.some((i) => m.total[i] !== null));
			const clear = answering.filter((m) => indices.some((i) => m.total[i] !== null && (m.total[i] as number) <= CLEAR_PCT));
			if (answering.length) parts.push(`${clear.length} of ${answering.length} models see clear hours`);
		}
		const dew = night.find((h) => h.temperature !== null && h.dewPoint !== null && h.temperature - h.dewPoint <= DEW_MARGIN_C);
		if (dew) parts.push(`dew likely from ${clock(dew.time)}`);
		const gusts = Math.max(0, ...night.map((h) => h.gusts ?? 0));
		if (gusts > GUSTY_MS) parts.push(`gusts to ${gusts.toFixed(0)} m/s`);
	}
	const pct = Math.round(sky.moon.illumination * 100);
	const moonUp = sky.moon.events.find((e) => e.kind === (sky.moon.upAtDark ? 'set' : 'rise') && e.at > from && e.at < to);
	parts.push(
		pct < 5 ? 'no moon to speak of' : sky.moon.upAtDark ? `moon ${pct} % up at dark${moonUp ? `, sets ${clock(moonUp.at)}` : ' all night'}` : `moon ${pct} %${moonUp ? `, rises ${clock(moonUp.at)}` : ' below the horizon'}`
	);
	const s = seeingPoints?.filter((p) => p.time > from && p.time < to && p.seeing !== null).map((p) => p.seeing as number) ?? [];
	if (s.length) parts.push(`seeing ${SEEING_ARCSEC[Math.round(s.reduce((a, b) => a + b, 0) / s.length)]} (7Timer)`);
	return parts.join(' · ');
}

/** Kp needed for aurora in sight at about 61–62° N (geomagnetic ~58°): low in the north from 3, overhead from 5. */
function auroraLine(k: { now: number | null; points: KpPoint[] } | null, a: Aurora | null): string {
	const now = Date.now();
	const next = k?.points.filter((p) => p.time > now && p.time < now + 24 * HOUR) ?? [];
	const maxNext = next.length ? Math.max(...next.map((p) => p.kp)) : null;
	const current = k?.now ?? null;
	const parts: string[] = [];
	if (a) {
		if (a.probability >= AURORA_PCT) parts.push(`Aurora likely overhead now (${a.probability} %): look up; deep-sky frames will catch it`);
		else if (a.northProbability >= AURORA_PCT) parts.push(`Aurora possible low in the north (${a.northProbability} % within ~1000 km): north-facing targets may brighten`);
		else parts.push(`No aurora expected now (${a.probability} % here)`);
	}
	if (current !== null) parts.push(`Kp ${current.toFixed(1)} in the latest 3 h`);
	if (maxNext !== null) parts.push(maxNext >= 5 ? `Kp up to ${maxNext.toFixed(1)} in the next 24 h: storm, aurora overhead possible` : maxNext >= 3 ? `Kp up to ${maxNext.toFixed(1)} in the next 24 h: northern horizon` : `Kp under 3 for the next 24 h: quiet`);
	return parts.join(' · ') || 'Aurora data unavailable';
}

/** Everything for the conditions page, for the night around now. */
export async function conditions(site: Site): Promise<Conditions> {
	const sky = nightSky(site.lat, site.lon, nightNoon(Date.now()));
	const [w, m, s, k, a] = await Promise.all([weather(site), models(site), seeing(site), kp(), aurora(site)]);
	// Hours from the one containing sunset to the one containing sunrise.
	const from = Math.floor((sky.sunset ?? sky.noon + 6 * HOUR) / HOUR) * HOUR;
	const to = sky.sunrise ?? sky.nextNoon - 4 * HOUR;
	const times: number[] = [];
	for (let t = from; t < to; t += HOUR) times.push(t);
	const pick = (src: { time: number[]; models: ModelClouds[] }): ModelClouds[] => {
		const index = times.map((t) => src.time.indexOf(t));
		const take = (col: Column) => index.map((i) => (i >= 0 ? col[i] : null));
		return src.models.map((mo) => ({ ...mo, total: take(mo.total), low: take(mo.low), mid: take(mo.mid), high: take(mo.high) }));
	};
	const night = (hs: WeatherHour[]) => hs.filter((h) => h.time >= from && h.time < to);
	return {
		site,
		sky,
		times,
		moonAltitude: times.map((t) => moonAltitude(site.lat, site.lon, t + HOUR / 2)),
		weather: w.data ? { ...w, data: night(w.data) } : w,
		models: m.data ? { ...m, data: pick(m.data) } : (m as Sourced<never>),
		seeing: s.data ? { ...s, data: s.data.filter((p) => p.time > from - 3 * HOUR && p.time < to + 3 * HOUR) } : s,
		kp: k,
		aurora: a,
		verdict: verdict(sky, w.data, m.data, s.data),
		auroraLine: auroraLine(k.data, a.data),
		updatedAt: Date.now()
	};
}
