// D6 and C4 from outside sources and the service: ERA5 cloud at the site (Open-Meteo's historical weather
// archive) for clear nights, the four cloud models' forecasts for each imaged night (Open-Meteo's
// previous-runs API: the run current 24 h before each hour and the latest run before it, the same models
// as the Conditions page), and the frames of every session (the service's details, kept per session
// version) to score them against.
import { cached, fetchJson } from './cache';
import { CLEAR_PCT, MODELS } from './conditions';
import type { Site } from './config';
import { upstreamJson } from './telescope';
import { judgeFrames, observedHours, rank, score, type ObservedFrame } from '$lib/forecasts';
import { altitude, nightNoon, sunAltitude } from '$lib/sky';
import type { ForecastHour, ForecastLead, ForecastReport, ForecastSession, Frame, ModelHour, ModelScore, SessionDetail, SessionSummary, Sourced } from '$lib/types';

const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** Session details fetched at once. */
const DETAIL_CONCURRENCY = 4;

type Column = (number | null)[];

const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/**
 * ERA5 hourly total cloud cover at the site from `start` (YYYY-MM-DD) to today, one request, cached a day.
 * ERA5 runs about six days behind (2026-10-19: last value 2026-10-13 23:00 UTC); later hours come back null.
 * `models=era5` on purpose: the archive's best match fills the recent days with the IFS forecast.
 */
export function era5Clouds(site: Site, start: string): Promise<Sourced<{ time: number[]; cloud: Column }>> {
	const end = day(Date.now());
	return cached(`era5 clouds ${site.lat},${site.lon} ${start} ${end}`, DAY, 7 * DAY, async () => {
		const url = new URL('https://archive-api.open-meteo.com/v1/archive');
		url.search = new URLSearchParams({
			latitude: String(site.lat),
			longitude: String(site.lon),
			hourly: 'cloud_cover',
			models: 'era5',
			timeformat: 'unixtime',
			timezone: 'GMT',
			start_date: start,
			end_date: end
		}).toString();
		const h = (await fetchJson<{ hourly: { time: number[]; cloud_cover: Column } }>(url, 20_000)).hourly;
		return { time: h.time, cloud: h.cloud_cover };
	});
}

interface NightForecast {
	/** Unix s. */
	time: number[];
	models: Record<string, { dayAhead: Column; latest: Column; low: Column; mid: Column; high: Column }>;
}

/**
 * The models' cloud for a night (UTC days `night` and the next): `cloud_cover_previous_day1` (the run current
 * 24 h before the hour; the API has no low/mid/high for it) and `cloud_cover` with low/mid/high (the latest run
 * before the hour, as the historical forecast API stitches it). Final once the night is over: kept 30 days.
 */
function nightForecast(site: Site, night: string): Promise<Sourced<NightForecast>> {
	const over = nightNoon(night) + DAY < Date.now();
	return cached(`forecast history ${site.lat},${site.lon} ${night}`, over ? 30 * DAY : 30 * MIN, 7 * DAY, async () => {
		const url = new URL('https://previous-runs-api.open-meteo.com/v1/forecast');
		url.search = new URLSearchParams({
			latitude: String(site.lat),
			longitude: String(site.lon),
			hourly: 'cloud_cover,cloud_cover_previous_day1,cloud_cover_low,cloud_cover_mid,cloud_cover_high',
			models: MODELS.map((m) => m.id).join(','),
			timeformat: 'unixtime',
			timezone: 'GMT',
			start_date: night,
			end_date: day(Date.parse(`${night}T00:00:00Z`) + DAY)
		}).toString();
		const h = (await fetchJson<{ hourly: { time: number[] } & Record<string, Column | undefined> }>(url, 15_000)).hourly;
		const column = (name: string, model: string) => h[`${name}_${model}`] ?? h.time.map(() => null);
		return {
			time: h.time,
			models: Object.fromEntries(
				MODELS.map((m) => [
					m.id,
					{
						dayAhead: column('cloud_cover_previous_day1', m.id),
						latest: column('cloud_cover', m.id),
						low: column('cloud_cover_low', m.id),
						mid: column('cloud_cover_mid', m.id),
						high: column('cloud_cover_high', m.id)
					}
				])
			)
		};
	});
}

type FrameRow = Pick<Frame, 'at' | 'exposureS' | 'stars' | 'backgroundAdu' | 'rejectReason'>;

/** Per session: its frames as of the summary's version (frame counts and last frame), refetched when it changes. */
const frameCache = new Map<string, { version: string; frames: FrameRow[]; ra: number | null; dec: number | null }>();

async function sessionFrames(s: SessionSummary): Promise<{ frames: FrameRow[]; ra: number | null; dec: number | null } | null> {
	const version = `${s.lastFrameAt} ${s.frames} ${s.accepted} ${s.rejected}`;
	const hit = frameCache.get(s.id);
	if (hit?.version === version) return hit;
	const detail = await upstreamJson<SessionDetail>(`/api/sessions/${encodeURIComponent(s.id)}`, 'telescope', 30_000);
	if (!detail) return null;
	const entry = {
		version,
		frames: detail.frames.map((f) => ({ at: f.at, exposureS: f.exposureS, stars: f.stars, backgroundAdu: f.backgroundAdu, rejectReason: f.rejectReason })),
		ra: detail.ra,
		dec: detail.dec
	};
	frameCache.set(s.id, entry);
	return entry;
}

/** `fn` over `items`, at most `limit` at a time, results in order. */
async function pooled<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
	const out: R[] = new Array(items.length);
	let next = 0;
	const worker = async () => {
		while (next < items.length) {
			const i = next++;
			out[i] = await fn(items[i]);
		}
	};
	await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
	return out;
}

const LEADS: ForecastLead[] = ['dayAhead', 'latest'];

/** C4: every session's hours, what the frames saw against each model, scores per session and overall. */
export async function forecastReport(site: Site, sessions: SessionSummary[]): Promise<ForecastReport> {
	const judgeable = sessions.filter((s) => s.mode !== 'Live');
	// One night after the other: of nine of these (20 variables, two days each) at once, two got HTTP 429.
	const loadForecasts = async () => {
		const out = new Map<string, Sourced<NightForecast>>();
		for (const night of new Set(judgeable.map((s) => s.night))) out.set(night, await nightForecast(site, night));
		return out;
	};
	const [forecasts, frameList] = await Promise.all([loadForecasts(), pooled(judgeable, DETAIL_CONCURRENCY, sessionFrames)]);
	const frames = new Map(judgeable.map((s, i) => [s.id, frameList[i]]));
	const pooledPairs: Record<ForecastLead, Record<string, { forecast: number | null; observed: number | null }[]>> = {
		dayAhead: Object.fromEntries(MODELS.map((m) => [m.id, []])),
		latest: Object.fromEntries(MODELS.map((m) => [m.id, []]))
	};
	const out: ForecastSession[] = sessions.map((s) => {
		const data = frames.get(s.id);
		const forecast = forecasts.get(s.night);
		const base = { id: s.id, night: s.night, target: s.target, mode: s.mode, firstFrameAt: s.firstFrameAt, lastFrameAt: s.lastFrameAt, forecastError: forecast?.error ?? null };
		const empty = { referenceStars: null, judgedFrames: 0, hours: [], scores: { dayAhead: [], latest: [] } };
		if (s.mode === 'Live') return { ...base, ...empty, forecastError: null, excluded: 'Live stacking: test shots, planets, often re-pointed' };
		if (!data || !forecast) return { ...base, ...empty, excluded: 'session details unavailable' };
		const ra = data.ra ?? s.ra ?? null;
		const dec = data.dec ?? s.dec ?? null;
		const observedFrames: ObservedFrame[] = data.frames.map((f) => {
			const exposureS = f.exposureS ?? 0;
			const mid = f.at + exposureS / 2;
			return {
				mid,
				exposureS,
				stars: f.stars,
				backgroundAdu: f.backgroundAdu,
				rejectReason: f.rejectReason,
				sunAltitude: sunAltitude(site.lat, site.lon, mid * 1000),
				targetAltitude: ra !== null && dec !== null ? altitude(ra, dec, site.lat, site.lon, mid * 1000) : null
			};
		});
		const judged = judgeFrames(observedFrames);
		if (judged.excluded) return { ...base, ...empty, referenceStars: judged.referenceStars, excluded: judged.excluded };
		const index = new Map((forecast.data?.time ?? []).map((t, j) => [t, j]));
		const hours: ForecastHour[] = observedHours(judged.frames).map((h) => {
			const j = index.get(h.time);
			const models: Record<string, ModelHour> = {};
			for (const m of MODELS) {
				const c = forecast.data?.models[m.id];
				models[m.id] =
					c && j !== undefined
						? { dayAhead: c.dayAhead[j], latest: c.latest[j], low: c.low[j], mid: c.mid[j], high: c.high[j] }
						: { dayAhead: null, latest: null, low: null, mid: null, high: null };
			}
			return { ...h, models };
		});
		const scores = Object.fromEntries(
			LEADS.map((lead) => [
				lead,
				rank(
					MODELS.map((m) => {
						const pairs = hours.map((h) => ({ forecast: h.models[m.id][lead], observed: h.observed }));
						pooledPairs[lead][m.id].push(...pairs);
						return score(m.id, m.label, pairs, CLEAR_PCT);
					})
				)
			])
		) as Record<ForecastLead, ModelScore[]>;
		return { ...base, referenceStars: judged.referenceStars, judgedFrames: judged.frames.length, hours, scores, excluded: null };
	});
	return {
		clearPct: CLEAR_PCT,
		models: MODELS,
		sessions: out,
		leaderboard: Object.fromEntries(LEADS.map((lead) => [lead, rank(MODELS.map((m) => score(m.id, m.label, pooledPairs[lead][m.id], CLEAR_PCT)))])) as Record<ForecastLead, ModelScore[]>
	};
}
