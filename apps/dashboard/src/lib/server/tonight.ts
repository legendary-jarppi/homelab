// "Tonight at the cabin" for the Telescope tab: darkness and the moon from SunCalc (computed, works
// offline), clouds and dew from Open-Meteo. The night runs from the evening's noon to the next noon
// (Europe/Helsinki); until 09:00 it is the night just ending.
import { getMoonIllumination, getMoonPosition, getMoonTimes, getPosition, getTimes } from 'suncalc';
import type { WeatherLocation } from './config';
import type { TonightData } from '$lib/types';

const ZONE = 'Europe/Helsinki';
const HOUR = 3_600_000;
const WEATHER_CACHE_MS = 30 * 60_000;

const parts = new Intl.DateTimeFormat('en-GB', {
	timeZone: ZONE,
	hourCycle: 'h23',
	year: 'numeric',
	month: '2-digit',
	day: '2-digit',
	hour: '2-digit',
	minute: '2-digit',
	second: '2-digit'
});

/** Helsinki's UTC offset at an instant, minutes. */
function offsetMinutes(ms: number): number {
	const p = Object.fromEntries(parts.formatToParts(ms).map((x) => [x.type, Number(x.value)]));
	const wall = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
	return Math.round((wall - Math.floor(ms / 1000) * 1000) / 60_000);
}

/** The instant of a Helsinki wall-clock hour on day (y, m, d); m is 1-based, d may overflow. */
function helsinki(y: number, m: number, d: number, hour: number): number {
	const guess = Date.UTC(y, m - 1, d, hour);
	return guess - offsetMinutes(guess - offsetMinutes(guess) * 60_000) * 60_000;
}

/** Darkness and moon for the night that starts on the evening of `now`'s Helsinki day (before 09:00: the previous evening). */
export function astronomy(site: WeatherLocation, now = Date.now()) {
	const p = Object.fromEntries(parts.formatToParts(now).map((x) => [x.type, Number(x.value)]));
	const day = p.hour < 9 ? p.day - 1 : p.day;
	const noon = helsinki(p.year, p.month, day, 12);
	const nextNoon = helsinki(p.year, p.month, day + 1, 12);
	const { latitude: lat, longitude: lon } = site;

	const evening = getTimes(new Date(noon), lat, lon, 0, offsetMinutes(noon));
	const morning = getTimes(new Date(nextNoon), lat, lon, 0, offsetMinutes(nextNoon));
	const astronomical = evening.night && morning.nightEnd ? { start: evening.night.getTime(), end: morning.nightEnd.getTime() } : null;
	const nautical = evening.nauticalDusk && morning.nauticalDawn ? { start: evening.nauticalDusk.getTime(), end: morning.nauticalDawn.getTime() } : null;
	const sunset = evening.sunset?.getTime() ?? null;
	const sunrise = morning.sunrise?.getTime() ?? null;
	// Solar midnight: half a day after the evening's solar noon.
	const midnight = evening.solarNoon.getTime() + 12 * HOUR;
	const sunLowest = getPosition(new Date(midnight), lat, lon).altitude;

	const events = [getMoonTimes(new Date(noon), lat, lon, offsetMinutes(noon)), getMoonTimes(new Date(nextNoon), lat, lon, offsetMinutes(nextNoon))]
		.flatMap((t) => [
			...(t.rise ? [{ at: t.rise.getTime(), kind: 'rise' as const }] : []),
			...(t.set ? [{ at: t.set.getTime(), kind: 'set' as const }] : [])
		])
		.filter((e) => e.at >= noon && e.at < nextNoon)
		.sort((a, b) => a.at - b.at);
	const darkStart = astronomical?.start ?? nautical?.start ?? sunset ?? noon + 9 * HOUR;
	const illumination = getMoonIllumination(new Date(midnight));

	return {
		noon,
		nextNoon,
		sunset,
		sunrise,
		astronomical,
		nautical,
		sunLowest,
		moon: {
			illumination: illumination.fraction,
			phase: illumination.phase,
			events,
			// Rises and sets use the centre at about +0.13° (parallax, refraction and the disc).
			upAtDark: getMoonPosition(new Date(darkStart), lat, lon).altitude > 0.13
		}
	};
}

type Hourly = { time: number[] } & Record<'cloud_cover' | 'cloud_cover_low' | 'cloud_cover_mid' | 'cloud_cover_high' | 'temperature_2m' | 'dew_point_2m', (number | null)[]>;
let cached: { key: string; hourly: Hourly; at: number } | null = null;

/** Open-Meteo hourly clouds, temperature and dew point around now (yesterday to the day after tomorrow), cached 30 min. */
async function hourly(site: WeatherLocation): Promise<Hourly> {
	const key = `${site.latitude},${site.longitude}`;
	if (cached && cached.key === key && Date.now() - cached.at < WEATHER_CACHE_MS) return cached.hourly;
	const url = new URL('https://api.open-meteo.com/v1/forecast');
	url.search = new URLSearchParams({
		latitude: String(site.latitude),
		longitude: String(site.longitude),
		hourly: 'cloud_cover,cloud_cover_low,cloud_cover_mid,cloud_cover_high,temperature_2m,dew_point_2m',
		timeformat: 'unixtime',
		timezone: 'GMT',
		past_days: '1',
		forecast_days: '3'
	}).toString();
	const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
	if (!response.ok) throw new Error(`Open-Meteo: ${response.status}`);
	const body = (await response.json()) as { hourly: Hourly };
	cached = { key, hourly: body.hourly, at: Date.now() };
	return body.hourly;
}

export async function tonight(site: WeatherLocation): Promise<TonightData> {
	const sky = astronomy(site);
	// Hours from the one containing sunset to the one containing sunrise.
	const from = Math.floor((sky.sunset ?? sky.noon + 6 * HOUR) / HOUR) * HOUR;
	const to = sky.sunrise ?? sky.nextNoon - 4 * HOUR;
	let hours: TonightData['hours'] = null;
	let weatherError: string | null = null;
	try {
		const h = await hourly(site);
		hours = h.time
			.map((t, i) => ({
				time: t * 1000,
				cloud: h.cloud_cover[i],
				low: h.cloud_cover_low[i],
				mid: h.cloud_cover_mid[i],
				high: h.cloud_cover_high[i],
				temperature: h.temperature_2m[i],
				dewPoint: h.dew_point_2m[i]
			}))
			.filter((hour) => hour.time >= from && hour.time < to);
	} catch (e) {
		weatherError = (e as Error).message;
		console.error('tonight: forecast:', e);
	}
	return {
		site: { name: site.name, latitude: site.latitude, longitude: site.longitude },
		sunset: sky.sunset,
		sunrise: sky.sunrise,
		astronomical: sky.astronomical,
		nautical: sky.nautical,
		sunLowest: sky.sunLowest,
		moon: sky.moon,
		hours,
		weatherError,
		updatedAt: Date.now()
	};
}
