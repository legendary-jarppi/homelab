// C1: when each catalog object is well placed on a night at the site. Darkness is astronomical (sun
// below −18°), or nautical (−12°) on the light nights that have none; the object counts while it is above
// the minimum altitude in that window. Everything is computed in the browser (SunCalc and sky.ts).
import { horizontal, moonHorizontal, sky as nightSky, transit } from './sky';
import type { Sky, TimeWindow } from './types';

const MINUTE = 60_000;
const HOUR = 3_600_000;
/** Sampling step of the altitude curves and the hours above the limit. */
export const STEP_MS = 10 * MINUTE;
export const DEFAULT_MIN_ALTITUDE = 30;
/** "Well placed tonight": at least this long above the limit in darkness, and not beside a bright moon. */
export const WELL_PLACED_HOURS = 2;

export interface NightPlan {
	site: { lat: number; lon: number };
	sky: Sky;
	/** The darkness the hours are counted in. */
	window: TimeWindow | null;
	darkness: 'astronomical' | 'nautical' | null;
	/** Chart span: sunset to sunrise. */
	from: number;
	to: number;
	/** Sample instants over [from, to] and whether each is in the window. */
	times: number[];
	inWindow: boolean[];
	moon: { altitude: number; azimuth: number }[];
}

export interface TargetPlan {
	/** Hours above the limit in the window. */
	hours: number;
	/** Highest altitude in the window. */
	maxAltitude: number;
	/** The longest stretch above the limit in the window. */
	best: TimeWindow | null;
	/** The transit nearest the middle of the night, and the altitude there. */
	transit: number;
	transitAltitude: number;
	/** Closest to the moon while above the limit with the moon up (else at the middle of the night), degrees. */
	moonDistance: number;
	/** The moon is up during some of the object's hours. */
	moonUp: boolean;
	/** Best-first ordering by position alone: hours, a little for altitude, less with a bright moon up nearby. */
	score: number;
}

export function planNight(site: { lat: number; lon: number }, noon: number): NightPlan {
	const s = nightSky(site.lat, site.lon, noon);
	const window = s.astronomical ?? s.nautical;
	const from = s.sunset ?? noon + 6 * HOUR;
	const to = s.sunrise ?? s.nextNoon - 6 * HOUR;
	const times: number[] = [];
	for (let t = Math.floor(from / STEP_MS) * STEP_MS; t <= to; t += STEP_MS) times.push(t);
	return {
		site,
		sky: s,
		window,
		darkness: s.astronomical ? 'astronomical' : s.nautical ? 'nautical' : null,
		from,
		to,
		times,
		inWindow: times.map((t) => window !== null && t >= window.start && t < window.end),
		moon: times.map((t) => moonHorizontal(site.lat, site.lon, t))
	};
}

/** Angular distance between two alt/az positions, degrees. */
function apart(a: { altitude: number; azimuth: number }, b: { altitude: number; azimuth: number }): number {
	const r = Math.PI / 180;
	const c = Math.sin(a.altitude * r) * Math.sin(b.altitude * r) + Math.cos(a.altitude * r) * Math.cos(b.altitude * r) * Math.cos((a.azimuth - b.azimuth) * r);
	return Math.acos(Math.max(-1, Math.min(1, c))) / r;
}

export function planTarget(o: { ra: number; dec: number }, night: NightPlan, minAltitude: number): TargetPlan {
	const { lat, lon } = night.site;
	let steps = 0;
	let moonSteps = 0;
	let moonDistance = 180;
	let maxAltitude = -90;
	let run: TimeWindow | null = null;
	let best: TimeWindow | null = null;
	for (let i = 0; i < night.times.length; i++) {
		if (!night.inWindow[i]) continue;
		const t = night.times[i];
		const here = horizontal(o.ra, o.dec, lat, lon, t);
		if (here.altitude > maxAltitude) maxAltitude = here.altitude;
		if (here.altitude >= minAltitude) {
			steps++;
			// The moon while the object is usable: how long it is up, and how close it comes.
			if (night.moon[i].altitude > 0) {
				moonSteps++;
				moonDistance = Math.min(moonDistance, apart(here, night.moon[i]));
			}
			run = run ? { start: run.start, end: t + STEP_MS } : { start: t, end: t + STEP_MS };
			if (!best || run.end - run.start > best.end - best.start) best = run;
		} else run = null;
	}
	if (steps === 0) {
		// Not usable: the moon's distance at the middle of the night, for the list.
		const mid = night.window ? (night.window.start + night.window.end) / 2 : (night.from + night.to) / 2;
		const moon = moonHorizontal(lat, lon, mid);
		moonDistance = apart(horizontal(o.ra, o.dec, lat, lon, mid), moon);
		moonSteps = moon.altitude > 0 ? 1 : 0;
		if (!night.window) maxAltitude = horizontal(o.ra, o.dec, lat, lon, mid).altitude;
	}
	const hours = (steps * STEP_MS) / HOUR;
	const moonUpFraction = steps ? moonSteps / steps : 0;
	const moonPenalty = night.sky.moon.illumination * moonUpFraction * Math.max(0, 1 - moonDistance / 60) * 0.6;
	return {
		hours,
		maxAltitude,
		best,
		transit: transit(o.ra, lon, (night.from + night.to) / 2),
		transitAltitude: 90 - Math.abs(lat - o.dec),
		moonDistance,
		moonUp: moonSteps > 0,
		score: hours * (0.75 + (0.25 * Math.max(0, maxAltitude)) / 90) * (1 - moonPenalty)
	};
}

/** The object's altitude over the night's samples, [unix s, degrees] for TimeChart. */
export function altitudeCurve(o: { ra: number; dec: number }, night: NightPlan): [number, number][] {
	return night.times.map((t) => [t / 1000, horizontal(o.ra, o.dec, night.site.lat, night.site.lon, t).altitude]);
}

/** "Well placed", or why not. */
export function placement(p: TargetPlan, illumination: number): { good: boolean; text: string } {
	if (p.hours <= 0) return { good: false, text: 'not above the limit in darkness' };
	const moonText = p.moonUp && illumination > 0.3 && p.moonDistance < 40 ? `, moon ${Math.round(p.moonDistance)}° away` : '';
	return p.hours >= WELL_PLACED_HOURS && !moonText ? { good: true, text: `well placed, ${p.hours.toFixed(1)} h` } : { good: false, text: `${p.hours.toFixed(1)} h${moonText}` };
}

const DATE = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Helsinki', year: 'numeric', month: '2-digit', day: '2-digit' });

/** The night's date "YYYY-MM-DD" (the evening it starts) of a nightNoon(). */
export const nightDate = (noon: number) => DATE.format(noon);
