// C4: what the frames saw of the sky, hour by hour, to score the cloud forecasts against. A frame's star
// count against the session's clear reference says how much of the sky's light got through; frames in
// twilight, low over the trees or spoilt for other reasons (focus, trailing, guiding) are not judged.
// Pure (the server prepares the frames with the sun's and the target's altitude); thresholds as named
// constants, the clear/cloudy line (CLEAR_PCT) passed in.
import { LOW_ALTITUDE } from './sky';
import type { ModelScore } from './types';

/** Frames with the sun higher than this (degrees) are twilight: the sky brightens and stars fade without cloud. */
export const DARK_SUN_DEG = -12;
/** The clear reference: this percentile of the judged frames' star counts. */
export const REFERENCE_PERCENTILE = 0.9;
/** Stars at or above this share of the reference: clear. */
export const CLEAR_RATIO = 0.8;
/** Stars below this share of the reference: cloudy (in between: partly, linearly). */
export const CLOUDY_RATIO = 0.5;
/** Background this many times the judged frames' median, with stars under CLEAR_RATIO: clouds lit from below. */
export const BACKGROUND_RATIO = 1.5;
/** A session needs this many judged frames for a reference. */
export const MIN_SESSION_FRAMES = 10;
/** An hour needs this much judged exposure (s) to count. */
export const MIN_HOUR_EXPOSURE_S = 1200;
/** A frame counts as cloudy in the hour's tally from this cloudiness on. */
export const CLOUDY_FRAME = 0.5;

/** First reasons that are not about the sky: blur and trailing lower the star count too. */
const NOT_SKY = /^(HFR|stars elongated|guiding RMS)/;
/** First reasons from the star count: the service's own cloud call. */
const CLOUD_REASON = /^(only \d+ stars|stars \d+ % of session median)/;

export interface ObservedFrame {
	/** Middle of the exposure, unix s. */
	mid: number;
	exposureS: number;
	stars: number | null;
	backgroundAdu: number | null;
	rejectReason: string | null;
	/** Degrees at `mid`; the target's null when the session has no position. */
	sunAltitude: number;
	targetAltitude: number | null;
}

export interface JudgedFrame {
	mid: number;
	exposureS: number;
	/** 0 clear … 1 cloudy. */
	cloudiness: number;
}

export interface ObservedHour {
	time: number;
	observed: number | null;
	exposureS: number;
	frames: number;
	cloudyFrames: number;
}

function percentile(sorted: number[], p: number): number {
	return sorted[Math.floor(p * (sorted.length - 1))];
}

/** The judged frames' cloudiness, or why the session cannot be judged. */
export function judgeFrames(frames: ObservedFrame[]): { referenceStars: number | null; frames: JudgedFrame[]; excluded: string | null } {
	const eligible = frames.filter(
		(f) =>
			f.stars !== null &&
			f.sunAltitude <= DARK_SUN_DEG &&
			(f.targetAltitude === null || f.targetAltitude >= LOW_ALTITUDE) &&
			!NOT_SKY.test(f.rejectReason ?? '')
	);
	if (eligible.length < MIN_SESSION_FRAMES) return { referenceStars: null, frames: [], excluded: `${eligible.length} frames in darkness above ${LOW_ALTITUDE}°, ${MIN_SESSION_FRAMES} needed` };
	const reference = percentile(eligible.map((f) => f.stars as number).sort((a, b) => a - b), REFERENCE_PERCENTILE);
	if (reference <= 0) return { referenceStars: reference, frames: [], excluded: 'no stars in the frames' };
	const backgrounds = eligible.flatMap((f) => (f.backgroundAdu === null ? [] : [f.backgroundAdu])).sort((a, b) => a - b);
	const background = backgrounds.length ? percentile(backgrounds, 0.5) : null;
	return {
		referenceStars: reference,
		excluded: null,
		frames: eligible.map((f) => {
			const ratio = (f.stars as number) / reference;
			const lit = background !== null && f.backgroundAdu !== null && f.backgroundAdu >= BACKGROUND_RATIO * background && ratio < CLEAR_RATIO;
			const cloudiness = ratio < CLOUDY_RATIO || lit || CLOUD_REASON.test(f.rejectReason ?? '') ? 1 : Math.min(1, Math.max(0, (CLEAR_RATIO - ratio) / (CLEAR_RATIO - CLOUDY_RATIO)));
			return { mid: f.mid, exposureS: f.exposureS, cloudiness };
		})
	};
}

/** Per hour mark (frames whose middle is within ±30 min): exposure-weighted cloudiness as %, null under MIN_HOUR_EXPOSURE_S. */
export function observedHours(frames: JudgedFrame[]): ObservedHour[] {
	const hours = new Map<number, { exposureS: number; weighted: number; frames: number; cloudyFrames: number }>();
	for (const f of frames) {
		const time = Math.round(f.mid / 3600) * 3600;
		let h = hours.get(time);
		if (!h) hours.set(time, (h = { exposureS: 0, weighted: 0, frames: 0, cloudyFrames: 0 }));
		h.exposureS += f.exposureS;
		h.weighted += f.cloudiness * f.exposureS;
		h.frames++;
		if (f.cloudiness >= CLOUDY_FRAME) h.cloudyFrames++;
	}
	return [...hours.entries()]
		.sort((a, b) => a[0] - b[0])
		.map(([time, h]) => ({
			time,
			observed: h.exposureS >= MIN_HOUR_EXPOSURE_S ? Math.round((100 * h.weighted) / h.exposureS) : null,
			exposureS: Math.round(h.exposureS),
			frames: h.frames,
			cloudyFrames: h.cloudyFrames
		}));
}

/** Hit rate of the clear/cloudy call at `clearPct`, mean absolute error and bias over the hours where both exist. */
export function score(id: string, label: string, pairs: { forecast: number | null; observed: number | null }[], clearPct: number): ModelScore {
	let hours = 0;
	let hits = 0;
	let absolute = 0;
	let signed = 0;
	for (const { forecast, observed } of pairs) {
		if (forecast === null || observed === null) continue;
		hours++;
		if (forecast <= clearPct === observed <= clearPct) hits++;
		absolute += Math.abs(forecast - observed);
		signed += forecast - observed;
	}
	const round = (v: number) => Math.round(v * 10) / 10;
	return { id, label, hours, hits, hitRate: hours ? hits / hours : null, mae: hours ? round(absolute / hours) : null, bias: hours ? round(signed / hours) : null };
}

/** Best first: hit rate, then the smaller mean error; models without hours last. */
export function rank(scores: ModelScore[]): ModelScore[] {
	return [...scores].sort((a, b) => (b.hitRate ?? -1) - (a.hitRate ?? -1) || (a.mae ?? Infinity) - (b.mae ?? Infinity));
}
