// R6: how long a target needs, from what the service measured in its frames (sky brightness, sky
// electrons per pixel, read noise). Per camera pixel, in the green-equivalent electrons of the
// service's photometry (apps/telescope skyq.py). An object of surface brightness μ gives, relative to
// a sky of brightness m and B e-/s per pixel, O = B · 10^(−0.4 (μ − m)) e-/s per pixel: no pixel scale
// or zero point needed (both are in m and B). After a total T in subs of t seconds the pixel's
//   SNR = O·T / √(T·(O + B + D) + (T / t)·RN²)
// so SNR s needs T = s² · (O + B + D + RN²/t) / O². Dark current D is left out (measured
// 0.0004 e-/s at −20 °C, under 1 % of the darkest sky). Pure functions: tests/exposure.test.ts.

/** The SNR per pixel the estimates are for. */
export const SNR_TARGET = 10;
/** Faint nebulosity, mag/arcsec², the generic estimate for every target. */
export const FAINT_SB = 23;
/** Catalog surface brightness only for these groups (an open cluster's mean surface brightness says nothing). */
export const SB_GROUPS: Record<string, true> = { galaxy: true, planetary: true, nebula: true };

export interface SkyInputs {
	/** mag/arcsec². */
	skyMag: number;
	/** e-/s per camera pixel. */
	skyEps: number;
	readNoiseE: number;
	/** Sub length, s. */
	subS: number;
	/** e-/s per pixel (default 0). */
	darkEps?: number;
}

/** A session's measured numbers (the service's summary fields). */
export interface MeasuredSession {
	skyMag?: number | null;
	skyEps?: number | null;
	readNoiseE?: number | null;
	exposureS?: number | null;
	integrationS: number;
	firstFrameAt: number;
}

/** Mean surface brightness (mag/arcsec²) of a catalog object: its magnitude spread over its ellipse (axes in arcmin). */
export function meanSurfaceBrightness(mag: number | null, majArcmin: number | null, minArcmin: number | null): number | null {
	if (mag === null || !majArcmin || majArcmin <= 0) return null;
	const area = (Math.PI / 4) * majArcmin * 60 * ((minArcmin && minArcmin > 0 ? minArcmin : majArcmin) * 60);
	return mag + 2.5 * Math.log10(area);
}

/** The object's e-/s per pixel at surface brightness `sb` under a sky of `skyMag` giving `skyEps`. */
export const objectRate = (sb: number, skyMag: number, skyEps: number) => skyEps * 10 ** (-0.4 * (sb - skyMag));

/** Total integration (s) for `snr` per pixel at surface brightness `sb`. */
export function integrationFor(snr: number, sb: number, sky: SkyInputs): number {
	const o = objectRate(sb, sky.skyMag, sky.skyEps);
	return (snr * snr * (o + sky.skyEps + (sky.darkEps ?? 0) + sky.readNoiseE ** 2 / sky.subS)) / (o * o);
}

/** SNR per pixel after `integrationS` in subs of `sky.subS`. */
export function snrAfter(integrationS: number, sb: number, sky: SkyInputs): number {
	if (integrationS <= 0) return 0;
	const o = objectRate(sb, sky.skyMag, sky.skyEps);
	return (o * integrationS) / Math.sqrt(integrationS * (o + sky.skyEps + (sky.darkEps ?? 0)) + (integrationS / sky.subS) * sky.readNoiseE ** 2);
}

export interface TargetEstimate {
	/** SNR per pixel of the accepted integration so far (each session with its own sky). */
	snrNow: number;
	/** The whole integration for `snr` at the newest session's sky and sub length, s. */
	totalS: number;
	/** What is still missing at that sky, s (0 when reached). */
	moreS: number;
	/** The sky the estimate is for (the newest measured session). */
	sky: SkyInputs;
	/** Sessions with measured numbers that the SNR so far rests on, and the integration without them. */
	sessions: number;
	unmeasuredS: number;
}

/**
 * For a target's sessions: the SNR per pixel at `sb` of what was gathered (signal and variance of each
 * session added up, so a moonlit night counts for less), and the integration still needed for `snr` at the
 * newest measured session's sky. Null without a measured session.
 */
export function targetEstimate(sessions: MeasuredSession[], sb: number, snr = SNR_TARGET): TargetEstimate | null {
	let signal = 0;
	let variance = 0;
	let count = 0;
	let unmeasuredS = 0;
	let newest: { at: number; sky: SkyInputs } | null = null;
	for (const s of sessions) {
		if (s.skyMag === null || s.skyMag === undefined || !s.skyEps || s.skyEps <= 0 || !s.readNoiseE || !s.exposureS) {
			unmeasuredS += s.integrationS;
			continue;
		}
		const sky: SkyInputs = { skyMag: s.skyMag, skyEps: s.skyEps, readNoiseE: s.readNoiseE, subS: s.exposureS };
		const o = objectRate(sb, sky.skyMag, sky.skyEps);
		signal += o * s.integrationS;
		variance += s.integrationS * (o + sky.skyEps) + (s.integrationS / sky.subS) * sky.readNoiseE ** 2;
		count++;
		if (!newest || s.firstFrameAt > newest.at) newest = { at: s.firstFrameAt, sky };
	}
	if (!newest) return null;
	const sky = newest.sky;
	const o = objectRate(sb, sky.skyMag, sky.skyEps);
	const k = o + sky.skyEps + sky.readNoiseE ** 2 / sky.subS;
	const snrNow = variance > 0 ? signal / Math.sqrt(variance) : 0;
	// (signal + o·T)² = snr² · (variance + k·T), the positive root in T.
	let moreS = 0;
	if (snrNow < snr) {
		const b = 2 * signal * o - snr * snr * k;
		const c = signal * signal - snr * snr * variance;
		moreS = (-b + Math.sqrt(b * b - 4 * o * o * c)) / (2 * o * o);
	}
	return { snrNow, totalS: integrationFor(snr, sb, sky), moreS, sky, sessions: count, unmeasuredS };
}

/** "~11 h" / "~40 min". */
export function roughDuration(s: number): string {
	if (!Number.isFinite(s)) return 'too long';
	if (s < 3600) return `~${Math.max(1, Math.round(s / 60))} min`;
	const h = s / 3600;
	return `~${h < 10 ? h.toFixed(1) : Math.round(h)} h`;
}
