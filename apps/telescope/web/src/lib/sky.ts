// Sun, moon and target positions at the site, computed (SunCalc and the usual sidereal-time formula;
// works offline, in the browser and on the server). The night runs from the evening's noon to the
// next noon (Europe/Helsinki), the same approach as the dashboard's Tonight card
// (apps/dashboard/src/lib/server/tonight.ts).
import { getMoonIllumination, getMoonPosition, getMoonTimes, getPosition, getTimes } from 'suncalc';
import type { Sky } from './types';

const ZONE = 'Europe/Helsinki';
const HOUR = 3_600_000;
const RAD = Math.PI / 180;
/** The altitude a target is said to set at (trees, haze, airmass 2.9). */
export const LOW_ALTITUDE = 20;

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

function wall(ms: number): Record<string, number> {
	return Object.fromEntries(parts.formatToParts(ms).map((x) => [x.type, Number(x.value)]));
}

/** Helsinki's UTC offset at an instant, minutes. */
function offsetMinutes(ms: number): number {
	const p = wall(ms);
	const local = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
	return Math.round((local - Math.floor(ms / 1000) * 1000) / 60_000);
}

/** The instant of a Helsinki wall-clock hour on day (y, m, d); m is 1-based, d may overflow. */
function helsinki(y: number, m: number, d: number, hour: number): number {
	const guess = Date.UTC(y, m - 1, d, hour);
	return guess - offsetMinutes(guess - offsetMinutes(guess) * 60_000) * 60_000;
}

/** Noon (unix ms) of the evening a night starts: `night` "YYYY-MM-DD", or the night around `now` (before 09:00 the one ending). */
export function nightNoon(at: number | string): number {
	if (typeof at === 'string') {
		const [y, m, d] = at.split('-').map(Number);
		return helsinki(y, m, d, 12);
	}
	const p = wall(at);
	return helsinki(p.year, p.month, p.hour < 9 ? p.day - 1 : p.day, 12);
}

/** Darkness and moon for the night starting at `noon` (from nightNoon). */
export function sky(lat: number, lon: number, noon: number): Sky {
	const p = wall(noon);
	const nextNoon = helsinki(p.year, p.month, p.day + 1, 12);
	const evening = getTimes(new Date(noon), lat, lon, 0, offsetMinutes(noon));
	const morning = getTimes(new Date(nextNoon), lat, lon, 0, offsetMinutes(nextNoon));
	const valid = (d: Date | null | undefined) => (d && Number.isFinite(d.getTime()) ? d.getTime() : null);
	const window = (a: Date | null | undefined, b: Date | null | undefined) => {
		const start = valid(a);
		const end = valid(b);
		return start !== null && end !== null && end > start ? { start, end } : null;
	};
	const midnight = evening.solarNoon.getTime() + 12 * HOUR;
	const events = [getMoonTimes(new Date(noon), lat, lon, offsetMinutes(noon)), getMoonTimes(new Date(nextNoon), lat, lon, offsetMinutes(nextNoon))]
		.flatMap((t) => [...(t.rise ? [{ at: t.rise.getTime(), kind: 'rise' as const }] : []), ...(t.set ? [{ at: t.set.getTime(), kind: 'set' as const }] : [])])
		.filter((e) => e.at >= noon && e.at < nextNoon)
		.sort((a, b) => a.at - b.at);
	const astronomical = window(evening.night, morning.nightEnd);
	const nautical = window(evening.nauticalDusk, morning.nauticalDawn);
	const sunset = valid(evening.sunset);
	const darkStart = astronomical?.start ?? nautical?.start ?? sunset ?? noon + 9 * HOUR;
	const illumination = getMoonIllumination(new Date(midnight));
	return {
		noon,
		nextNoon,
		sunset,
		sunrise: valid(morning.sunrise),
		astronomical,
		nautical,
		sunLowest: getPosition(new Date(midnight), lat, lon).altitude / RAD,
		moon: {
			illumination: illumination.fraction,
			phase: illumination.phase,
			events,
			// Rises and sets use the centre at about +0.13° (parallax, refraction and the disc).
			upAtDark: getMoonPosition(new Date(darkStart), lat, lon).altitude > 0.13 * RAD
		}
	};
}

export const sunAltitude = (lat: number, lon: number, ms: number) => getPosition(new Date(ms), lat, lon).altitude / RAD;
export const moonAltitude = (lat: number, lon: number, ms: number) => getMoonPosition(new Date(ms), lat, lon).altitude / RAD;

/** Local sidereal time, degrees. */
function lst(ms: number, lon: number): number {
	const d = ms / 86_400_000 - 10957.5; // days since J2000.0
	return (((280.46061837 + 360.98564736629 * d + lon) % 360) + 360) % 360;
}

/** Altitude (degrees) of RA/Dec (degrees, J2000; precession ignored: under 0.4° by 2026) at the site. */
export function altitude(raDeg: number, decDeg: number, lat: number, lon: number, ms: number): number {
	const ha = (lst(ms, lon) - raDeg) * RAD;
	const s = Math.sin(lat * RAD) * Math.sin(decDeg * RAD) + Math.cos(lat * RAD) * Math.cos(decDeg * RAD) * Math.cos(ha);
	return Math.asin(Math.max(-1, Math.min(1, s))) / RAD;
}

/** The target's transit (on the meridian, highest) nearest to `ms`. */
export function transit(raDeg: number, lon: number, ms: number): number {
	let ha = (lst(ms, lon) - raDeg) % 360;
	if (ha > 180) ha -= 360;
	if (ha < -180) ha += 360;
	return ms - (ha / 360.98564736629) * 86_400_000;
}

/** First time in [from, to] the target goes below `limit` degrees (after being above it), or null. */
export function setsBelow(raDeg: number, decDeg: number, lat: number, lon: number, from: number, to: number, limit = LOW_ALTITUDE): number | null {
	const step = 5 * 60_000;
	let prev = altitude(raDeg, decDeg, lat, lon, from);
	for (let t = from + step; t <= to; t += step) {
		const a = altitude(raDeg, decDeg, lat, lon, t);
		if (prev >= limit && a < limit) return t - step + ((prev - limit) / (prev - a)) * step;
		prev = a;
	}
	return null;
}
