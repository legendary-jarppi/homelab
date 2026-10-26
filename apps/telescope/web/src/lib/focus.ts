// A5: focus against temperature from the auto focus runs (the service's GET /api/focus), shared by /stats/focus
// and the session report's Focus card.
import type { XYSeries } from '$lib/components/XYChart.svelte';
import type { AutofocusRun, FocusAdvice, Frame } from '$lib/types';

/** Fewer runs (on nights with at least two) than this give no coefficient worth showing. */
export const MIN_RUNS = 5;
/** The focuser reads whole degrees: a night needs at least this temperature span to tell a slope. */
export const MIN_RANGE_C = 3;
/** HFR drift: frames needed between two runs, and how many at each end are averaged. */
export const DRIFT_MIN_FRAMES = 4;
export const DRIFT_END_FRAMES = 3;
/** Prometheus has RuuviTag readings from this day on (apps/ruuvi reporting since 2026-10-17). */
export const RUUVI_SINCE = '2026-10-17';

/** Night colours, CSS variables only (night mode recolours them). */
export const NIGHT_COLORS = ['var(--line1)', 'var(--line2)', 'var(--line3)', 'var(--line4)', 'var(--ra)', 'var(--dec)', 'var(--accent)', 'var(--warn)'];

export interface FocusFit {
	/** Steps per °C (common to all nights) and its standard error; null when there is nothing to fit. */
	slope: number | null;
	slopeSe: number | null;
	/** Runs and nights that carry information (nights with two runs or more). */
	runs: number;
	nights: number;
	/** The widest temperature span within one night, °C. */
	rangeC: number;
	/** Each night's zero point: position = intercept + slope × T. */
	intercepts: Record<string, number>;
	/** Why the coefficient is not meaningful, or null. */
	caveat: string | null;
}

/**
 * Least squares with a zero point per night and one slope: the focuser's zero moved between nights (≈5000
 * steps in February and April 2026, ≈6100 from September: the optical train changed), so a single line
 * through every run would fit the nights' offsets, not the temperature. slope = Σ(T−T̄ₙ)(P−P̄ₙ) / Σ(T−T̄ₙ)²
 * over nights n; its standard error √(s² / Σ(T−T̄ₙ)²) with s² = SSE / (runs − nights − 1).
 */
export function fitFocus(runs: AutofocusRun[]): FocusFit {
	const byNight = new Map<string, { t: number; p: number }[]>();
	for (const r of runs) {
		if (!r.success || r.temperatureC === null || r.position === null) continue;
		const night = r.night ?? '?';
		byNight.set(night, [...(byNight.get(night) ?? []), { t: r.temperatureC, p: r.position }]);
	}
	let sxx = 0;
	let sxy = 0;
	let n = 0;
	let nights = 0;
	let rangeC = 0;
	const means = new Map<string, { t: number; p: number }>();
	for (const [night, pts] of byNight) {
		const t = pts.reduce((a, b) => a + b.t, 0) / pts.length;
		const p = pts.reduce((a, b) => a + b.p, 0) / pts.length;
		means.set(night, { t, p });
		if (pts.length < 2) continue;
		n += pts.length;
		nights++;
		rangeC = Math.max(rangeC, Math.max(...pts.map((x) => x.t)) - Math.min(...pts.map((x) => x.t)));
		for (const x of pts) {
			sxx += (x.t - t) ** 2;
			sxy += (x.t - t) * (x.p - p);
		}
	}
	const slope = sxx > 0 ? sxy / sxx : null;
	let slopeSe: number | null = null;
	const dof = n - nights - 1;
	if (slope !== null && dof > 0) {
		let sse = 0;
		for (const [night, pts] of byNight) {
			const m = means.get(night)!;
			if (pts.length >= 2) for (const x of pts) sse += (x.p - m.p - slope * (x.t - m.t)) ** 2;
		}
		slopeSe = Math.sqrt(sse / dof / sxx);
	}
	const intercepts: Record<string, number> = {};
	if (slope !== null) for (const [night, m] of means) intercepts[night] = m.p - slope * m.t;
	let caveat: string | null = null;
	if (n < MIN_RUNS || slope === null) caveat = `Too few runs for a coefficient: ${n} on nights with at least two (needs ${MIN_RUNS}).`;
	else if (rangeC < MIN_RANGE_C) caveat = `Too small a temperature range: at most ${rangeC} °C within a night (needs ${MIN_RANGE_C} °C; the focuser reads whole degrees).`;
	else if (slopeSe !== null && Math.abs(slope) < 2 * slopeSe) caveat = 'The slope is within two standard errors of zero: no temperature dependence shown yet.';
	return { slope, slopeSe, runs: n, nights, rangeC, intercepts, caveat };
}

/** A run's V-curve as chart series: the V-curve steps as a line, the focus star search and the final approach as dots. */
export function vCurveSeries(run: AutofocusRun, color: string, faint = false): XYSeries[] {
	const step = (k: number) => run.points.filter((p) => p[2] === k).map(([pos, size]) => [pos, size] as [number, number]);
	const curve = step(1).sort((a, b) => a[0] - b[0]);
	if (faint) return [{ points: curve, color, kind: 'line', width: 1, opacity: 0.35 }];
	return [
		{ points: curve, color, kind: 'line' },
		{ points: curve, color, kind: 'dots', radius: 2.4 },
		{ points: step(0), color: 'var(--faint)', kind: 'dots', radius: 2.4 },
		{ points: step(2), color: 'var(--ok)', kind: 'dots', radius: 3 }
	];
}

export interface DriftInterval {
	night: string;
	from: AutofocusRun;
	to: AutofocusRun;
	frames: number;
	/** Focuser temperature change between the runs, °C, and the HFR change over the frames between them, px. */
	deltaC: number;
	deltaHfr: number;
	hfrStart: number;
	hfrEnd: number;
}

const median = (v: number[]) => {
	const s = [...v].sort((a, b) => a - b);
	return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

/**
 * HFR drift between consecutive successful runs of a night: the median HFR of the last DRIFT_END_FRAMES frames
 * before the next run minus that of the first ones after the run, against the focuser temperature change. Every
 * analysed frame with an HFR counts, rejected ones too (seeing and altitude move the HFR as well).
 */
export function hfrDrift(runs: AutofocusRun[], frames: Pick<Frame, 'at' | 'exposureS' | 'hfr'>[]): DriftInterval[] {
	const ok = runs.filter((r) => r.success && r.temperatureC !== null).sort((a, b) => a.at - b.at);
	const out: DriftInterval[] = [];
	for (let i = 0; i + 1 < ok.length; i++) {
		const a = ok[i];
		const b = ok[i + 1];
		if (a.night !== b.night) continue;
		const between = frames.filter((f) => f.hfr !== null && f.at >= (a.endedAt ?? a.at) && f.at + (f.exposureS ?? 0) <= b.at).sort((x, y) => x.at - y.at);
		if (between.length < DRIFT_MIN_FRAMES) continue;
		const hfrStart = median(between.slice(0, DRIFT_END_FRAMES).map((f) => f.hfr!));
		const hfrEnd = median(between.slice(-DRIFT_END_FRAMES).map((f) => f.hfr!));
		out.push({ night: a.night ?? '?', from: a, to: b, frames: between.length, deltaC: b.temperatureC! - a.temperatureC!, deltaHfr: hfrEnd - hfrStart, hfrStart, hfrEnd });
	}
	return out;
}

// --- R6: focus advice ---------------------------------------------------------------------------------------

/**
 * Stars this much larger than at best focus count as out of focus. Background-limited, a star's signal-to-noise
 * goes as 1/size (its light spread over size² pixels of sky noise), so 5 % larger stars cost ~10 % of the
 * integration for the same depth; 10 % would cost ~21 %.
 */
export const TOLERANCE_PCT = 5;
/** V-curve points with stars more than this many times the smallest are left out of the fit (far out of focus the
 * ASIAIR measures donuts badly: 26 at 8× the minimum on 2026-10-19 lies off every curve). */
export const VCURVE_MAX_RATIO = 4;
/** A V-curve needs this many points in the fit, at least VCURVE_MIN_SIDE on each side of its best position. */
export const VCURVE_MIN_POINTS = 6;
export const VCURVE_MIN_SIDE = 2;
/** Refocus check: frames of the same session within this many seconds before and after a run. */
export const REFOCUS_WINDOW_S = 1800;
/** Fewer refocus moves than this (on either side of TOLERANCE_PCT) tell nothing about the prediction. */
export const MIN_CHECK_MOVES = 3;
/** The focuser's temperature reading is in whole degrees: the ASIAIR cannot react to less. */
export const FOCUSER_RESOLUTION_C = 1;

export interface VCurveFit {
	at: number;
	night: string | null;
	/** Position of the smallest stars and their size there (the ASIAIR's star size units). */
	bestPos: number;
	minSize: number;
	/** Size per step far from focus (the V's arms) and minSize / slope: steps from best where the arms take over. */
	slope: number;
	halfWidth: number;
	/** RMS residual of the fitted points, star size units. */
	rms: number;
	points: number;
	/** Steps from best where the stars are TOLERANCE_PCT larger. */
	toleranceSteps: number;
}

/** Star size on a fitted V-curve at a focuser position. */
export const vCurveSize = (fit: VCurveFit, pos: number) => Math.hypot(fit.minSize, fit.slope * (pos - fit.bestPos));

/** Steps from best focus at which a hyperbola of this half width grows by `pct` %. */
export const toleranceOf = (halfWidth: number, pct = TOLERANCE_PCT) => halfWidth * Math.sqrt((1 + pct / 100) ** 2 - 1);

/** How much larger (%) the stars are `offsetSteps` from best on a curve of this half width. */
export const growthPct = (offsetSteps: number, halfWidth: number) => (Math.hypot(1, offsetSteps / halfWidth) - 1) * 100;

/**
 * A run's V-curve as a hyperbola, size = √(minSize² + slope²·(pos − bestPos)²): a star's size is the seeing and
 * optics blur and the defocus blur added in quadrature, and the defocus blur grows linearly with the focuser's
 * offset (the light cone), so the curve is a V far out and rounds off at the bottom. A parabola fits only the few
 * bottom points and a V not the bottom at all, and the tolerance is about exactly that bottom. size² is quadratic
 * in the position, so it is a linear least-squares fit of size² = a + b·u + c·u² (u = pos − mean), weighted by
 * 1/size² (the same error in size for every point). Null without a usable minimum. On the 33 runs to 2026-10-19
 * the fitted points scatter 0.1–0.8 (median 0.3) about the curve; the ASIAIR reads sizes to 0.1.
 */
export function fitVCurve(run: AutofocusRun): VCurveFit | null {
	const curve = run.points.filter((p) => p[2] === 1 && p[1] > 0);
	if (!curve.length) return null;
	const smallest = Math.min(...curve.map((p) => p[1]));
	const pts = curve.filter((p) => p[1] <= VCURVE_MAX_RATIO * smallest);
	if (pts.length < VCURVE_MIN_POINTS) return null;
	const mean = pts.reduce((s, p) => s + p[0], 0) / pts.length;
	// Normal equations of the weighted fit, 3×3.
	const m = [
		[0, 0, 0, 0],
		[0, 0, 0, 0],
		[0, 0, 0, 0]
	];
	for (const [pos, size] of pts) {
		const u = pos - mean;
		const w = 1 / size ** 2;
		const f = [1, u, u * u];
		for (let i = 0; i < 3; i++) {
			for (let j = 0; j < 3; j++) m[i][j] += w * f[i] * f[j];
			m[i][3] += w * f[i] * size * size;
		}
	}
	const coef = solve3(m);
	if (!coef) return null;
	const [a, b, c] = coef;
	if (!(c > 0)) return null;
	const best = -b / (2 * c);
	const min2 = a - (b * b) / (4 * c);
	if (!(min2 > 0)) return null;
	const bestPos = best + mean;
	const below = pts.filter((p) => p[0] < bestPos).length;
	if (below < VCURVE_MIN_SIDE || pts.length - below < VCURVE_MIN_SIDE) return null;
	const minSize = Math.sqrt(min2);
	const slope = Math.sqrt(c);
	const halfWidth = minSize / slope;
	const fit = { at: run.at, night: run.night, bestPos, minSize, slope, halfWidth, rms: 0, points: pts.length, toleranceSteps: toleranceOf(halfWidth) };
	fit.rms = Math.sqrt(pts.reduce((s, [pos, size]) => s + (size - vCurveSize(fit, pos)) ** 2, 0) / pts.length);
	return fit;
}

/** Gaussian elimination with partial pivoting on an augmented 3×4 matrix (changed in place). */
function solve3(m: number[][]): number[] | null {
	for (let i = 0; i < 3; i++) {
		let p = i;
		for (let k = i + 1; k < 3; k++) if (Math.abs(m[k][i]) > Math.abs(m[p][i])) p = k;
		[m[i], m[p]] = [m[p], m[i]];
		if (Math.abs(m[i][i]) < 1e-12 * Math.max(1, Math.abs(m[0][0]))) return null;
		for (let k = i + 1; k < 3; k++) {
			const f = m[k][i] / m[i][i];
			for (let j = i; j < 4; j++) m[k][j] -= f * m[i][j];
		}
	}
	const x = [0, 0, 0];
	for (let i = 2; i >= 0; i--) {
		let s = m[i][3];
		for (let j = i + 1; j < 3; j++) s -= m[i][j] * x[j];
		x[i] = s / m[i][i];
	}
	return x;
}

/** Linear-interpolated quantile of numbers (q 0…1); NaN for none. */
export function quantile(values: number[], q: number): number {
	const s = [...values].sort((a, b) => a - b);
	if (!s.length) return NaN;
	const i = (s.length - 1) * q;
	const lo = Math.floor(i);
	return s[lo] + (s[Math.min(lo + 1, s.length - 1)] - s[lo]) * (i - lo);
}

/** What made the ASIAIR run auto focus, from the text after "Run AF" in its Autorun log. */
export type AfTrigger =
	| { kind: 'temperature'; degC: number; changeC: number | null }
	| { kind: 'time'; hours: number }
	| { kind: 'start' }
	| { kind: 'flip' }
	| { kind: 'other' };

const NUM = String.raw`(-?\d+(?:\.\d+)?)`;
const TEMPERATURE_TRIGGER = new RegExp(String.raw`temperature changed ${NUM} degrees?(?:,\s*${NUM}\s*℃? changed to ${NUM})?`, 'i');
const TIME_TRIGGER = new RegExp(String.raw`${NUM} hours? later`, 'i');

/** "when temperature changed 2 degrees, -10.0℃ changed to -13.0℃", "1 hours later", "before Autorun start", "after Auto Meridian filpped". */
export function parseTrigger(reason: string | null): AfTrigger {
	const text = reason ?? '';
	const t = TEMPERATURE_TRIGGER.exec(text);
	if (t) return { kind: 'temperature', degC: Number(t[1]), changeC: t[2] !== undefined && t[3] !== undefined ? Math.abs(Number(t[3]) - Number(t[2])) : null };
	const h = TIME_TRIGGER.exec(text);
	if (h) return { kind: 'time', hours: Number(h[1]) };
	if (/autorun start/i.test(text)) return { kind: 'start' };
	if (/meridian/i.test(text)) return { kind: 'flip' };
	return { kind: 'other' };
}

export interface AsiairTriggers {
	/** The temperature setting last seen in a run's reason, how often it fired, the changes it fired at, the night. */
	temperatureDegC: number | null;
	temperatureRuns: number;
	firedAtC: number[];
	temperatureNight: string | null;
	/** A later night on which the temperature changed by more than the setting between two runs without it firing (then it is probably off). */
	contradictedNight: string | null;
	/** The time trigger last seen, hours, and the night. */
	hours: number | null;
	hoursNight: string | null;
	/** Focuser temperature changes between consecutive successful runs of a night, °C (absolute). */
	betweenRunsC: number[];
}

/** The ASIAIR's auto focus triggers as its runs show them (the app's settings are not in the logs). */
export function asiairTriggers(runs: AutofocusRun[]): AsiairTriggers {
	const sorted = [...runs].sort((a, b) => a.at - b.at);
	const out: AsiairTriggers = { temperatureDegC: null, temperatureRuns: 0, firedAtC: [], temperatureNight: null, contradictedNight: null, hours: null, hoursNight: null, betweenRunsC: [] };
	let lastTempAt = -Infinity;
	for (const r of sorted) {
		const t = parseTrigger(r.reason);
		if (t.kind === 'temperature') {
			if (out.temperatureDegC !== t.degC) out.firedAtC = [];
			out.temperatureDegC = t.degC;
			out.temperatureRuns++;
			out.temperatureNight = r.night;
			if (t.changeC !== null) out.firedAtC.push(t.changeC);
			lastTempAt = r.at;
		} else if (t.kind === 'time') {
			out.hours = t.hours;
			out.hoursNight = r.night;
		}
	}
	const ok = sorted.filter((r) => r.success && r.temperatureC !== null);
	for (let i = 1; i < ok.length; i++) {
		const a = ok[i - 1];
		const b = ok[i];
		if (a.night !== b.night) continue;
		const change = Math.abs(b.temperatureC! - a.temperatureC!);
		out.betweenRunsC.push(change);
		if (out.temperatureDegC !== null && b.at > lastTempAt && change > out.temperatureDegC && parseTrigger(b.reason).kind !== 'temperature') out.contradictedNight ??= b.night;
	}
	return out;
}

/** A frame for the refocus check: the session it belongs to, its time, HFR and focuser position. */
export type CheckFrame = Pick<Frame, 'at' | 'exposureS' | 'hfr'> & { focusPos: number | null; session: string };

export interface RefocusMove {
	night: string;
	at: number;
	reason: string | null;
	/** The run's new position minus where the focuser stood before. */
	shiftSteps: number;
	/** How much larger the stars should have been before the run (the run's own fitted curve) and were (frames' HFR), %. */
	predictedPct: number;
	measuredPct: number;
	hfrBefore: number;
	hfrAfter: number;
}

/**
 * The cleanest test of the curves on the frames: when a run moves the focuser by `shift`, the stars before it were
 * off by that much, so the frames' HFR should drop by growthPct(shift) at the run, independent of the temperature.
 * Median HFR of the last DRIFT_END_FRAMES frames of the session ending before the run (within REFOCUS_WINDOW_S)
 * against the first ones after it. Runs that start a session have no frames before them in the session.
 */
export function refocusMoves(runs: AutofocusRun[], frames: CheckFrame[], fits: Map<number, VCurveFit>): RefocusMove[] {
	const out: RefocusMove[] = [];
	const sortedFrames = frames.filter((f) => f.hfr !== null).sort((a, b) => a.at - b.at);
	const ok = runs.filter((r) => r.success && r.position !== null).sort((a, b) => a.at - b.at);
	for (let i = 0; i < ok.length; i++) {
		const r = ok[i];
		const fit = fits.get(r.at);
		if (!fit) continue;
		const end = r.endedAt ?? r.at;
		const before = sortedFrames.filter((f) => f.at + (f.exposureS ?? 0) <= r.at && f.at + (f.exposureS ?? 0) >= r.at - REFOCUS_WINDOW_S);
		const after = sortedFrames.filter((f) => f.at >= end && f.at <= end + REFOCUS_WINDOW_S);
		if (!before.length || !after.length) continue;
		const session = before.at(-1)!.session;
		const b = before.filter((f) => f.session === session).slice(-DRIFT_END_FRAMES);
		const a = after.filter((f) => f.session === session).slice(0, DRIFT_END_FRAMES);
		if (b.length < DRIFT_END_FRAMES || a.length < DRIFT_END_FRAMES) continue;
		const prev = b.at(-1)!.focusPos ?? (i > 0 && ok[i - 1].night === r.night ? ok[i - 1].position : null);
		if (prev === null) continue;
		const hfrBefore = median(b.map((f) => f.hfr!));
		const hfrAfter = median(a.map((f) => f.hfr!));
		const shiftSteps = r.position! - prev;
		out.push({ night: r.night ?? '?', at: r.at, reason: r.reason, shiftSteps, predictedPct: growthPct(shiftSteps, fit.halfWidth), measuredPct: (hfrBefore / hfrAfter - 1) * 100, hfrBefore, hfrAfter });
	}
	return out;
}

export interface DriftCheck extends DriftInterval {
	/** Air temperature change over the interval (Open-Meteo at the site, interpolated), °C; null without it. Shown beside the focuser's: on 2026-02-13 the focuser read 3 °C less twice while the air cooled 0.2–0.3 °C (the tube cooling down), so the air cannot stand in for it. */
	airDeltaC: number | null;
	/** Predicted HFR growth from the focuser's temperature change (what the coefficient is fitted on) on the first run's curve, %, and the measured one. */
	predictedPct: number;
	measuredPct: number;
}

/** Interpolate an hourly series [unix s, value] at t; null outside it. */
export function interpolate(series: [number, number][], t: number): number | null {
	for (let i = 1; i < series.length; i++) {
		const [t0, v0] = series[i - 1];
		const [t1, v1] = series[i];
		if (t >= t0 && t <= t1) return t1 === t0 ? v0 : v0 + ((v1 - v0) * (t - t0)) / (t1 - t0);
	}
	return null;
}

/** Each HFR drift interval against what the focuser's temperature change and the first run's curve predict. */
export function driftChecks(intervals: DriftInterval[], fits: Map<number, VCurveFit>, slope: number, air: [number, number][] = []): DriftCheck[] {
	return intervals.flatMap((d) => {
		const fit = fits.get(d.from.at);
		if (!fit) return [];
		const t0 = interpolate(air, d.from.endedAt ?? d.from.at);
		const t1 = interpolate(air, d.to.at);
		const airDeltaC = t0 !== null && t1 !== null ? t1 - t0 : null;
		const predictedPct = growthPct(slope * d.deltaC, fit.halfWidth);
		return [{ ...d, airDeltaC, predictedPct, measuredPct: (d.hfrEnd / d.hfrStart - 1) * 100 }];
	});
}

export interface FocusAnalysis {
	fits: VCurveFit[];
	/** Successful runs with a V-curve that could not be fitted. */
	unfitted: number;
	/** Tolerance over the fitted curves: median and quartiles, steps. */
	toleranceSteps: number | null;
	toleranceQ1: number | null;
	toleranceQ3: number | null;
	fit: FocusFit;
	triggers: AsiairTriggers;
	moves: RefocusMove[];
	drift: DriftCheck[];
	/** Frame-to-frame HFR scatter: median |ΔHFR| / HFR between consecutive frames of a session, %. */
	hfrNoisePct: number | null;
	/** What the frames say about the prediction (plain English, the page's paragraph and the summary's sentence), or why they cannot tell. */
	check: string;
	verdict: string;
	advice: FocusAdvice | null;
}

/** HFR change between consecutive frames of the same session, median, % of the HFR. */
function hfrNoise(frames: CheckFrame[]): number | null {
	const sorted = frames.filter((f) => f.hfr !== null && f.hfr > 0).sort((a, b) => a.at - b.at);
	const d: number[] = [];
	for (let i = 1; i < sorted.length; i++) if (sorted[i].session === sorted[i - 1].session) d.push((Math.abs(sorted[i].hfr! - sorted[i - 1].hfr!) / sorted[i - 1].hfr!) * 100);
	return d.length ? median(d) : null;
}

const pct = (v: number) => `${v < -0.5 ? '−' : ''}${Math.abs(Math.round(v))} %`;
const steps = (v: number) => `${Math.round(v)} steps`;
const degrees = (v: number) => `${v < 10 ? Number(v.toFixed(1)) : Math.round(v)} °C`;

/**
 * What the frames say. Refocus moves: do larger moves bring the HFR down by about the predicted amount (against
 * the smaller moves, which show seeing alone)? Drift intervals: does the HFR grow more where the temperature
 * change predicts at least TOLERANCE_PCT than where it predicts less? `text` for the page, `verdict` for the summary.
 */
function checkTexts(moves: RefocusMove[], drift: DriftCheck[], noisePct: number | null): { text: string; verdict: string } {
	const big = moves.filter((m) => m.predictedPct >= TOLERANCE_PCT);
	const small = moves.filter((m) => m.predictedPct < TOLERANCE_PCT);
	const noise = noisePct !== null ? ` (frame-to-frame HFR scatter ${pct(noisePct)})` : '';
	let text: string;
	let verdict: string;
	if (big.length < MIN_CHECK_MOVES || small.length < MIN_CHECK_MOVES) {
		text = `Too few refocus runs with frames on both sides to check the curves against the frames: ${big.length} moved focus enough to matter (${TOLERANCE_PCT} % or more predicted), ${small.length} less (needs ${MIN_CHECK_MOVES} of each).`;
		verdict = 'Too few refocus runs with frames around them to check this against the frames yet.';
	} else {
		const bp = median(big.map((m) => m.predictedPct));
		const bm = median(big.map((m) => m.measuredPct));
		const sm = median(small.map((m) => m.measuredPct));
		const shift = median(big.map((m) => Math.abs(m.shiftSteps)));
		text = `At ${big.length} refocus runs that moved focus ${steps(shift)} (median) the stars should have been ${pct(bp)} larger before the run, and the frames' HFR dropped by ${pct(bm)}; at ${small.length} smaller moves by ${pct(sm)}${noise}.`;
		const what = `refocus runs that moved focus ${steps(shift)} made the frames' stars ${pct(bm)} smaller (${pct(bp)} predicted, ${big.length} runs; ${pct(sm)} at smaller moves)`;
		if (bm - sm >= Math.max(TOLERANCE_PCT, bp / 2)) verdict = `The frames agree: ${what}.`;
		else if (bm - sm <= 0) verdict = `The frames do not show it: ${what}; seeing changes more than focus did.`;
		else verdict = `The frames show less than predicted: ${what}; long exposures blur more than the ASIAIR's 2 s focus frames, so focus matters less in them.`;
		text += ` ${verdict.split(':')[0]}.`;
	}
	const warm = drift.filter((d) => d.predictedPct >= TOLERANCE_PCT);
	const still = drift.filter((d) => d.predictedPct < TOLERANCE_PCT);
	if (warm.length >= MIN_CHECK_MOVES && still.length >= MIN_CHECK_MOVES) {
		const wm = median(warm.map((d) => d.measuredPct));
		const wp = median(warm.map((d) => d.predictedPct));
		const sm = median(still.map((d) => d.measuredPct));
		text += ` Between runs the HFR grew ${pct(wm)} over ${warm.length} intervals where the temperature change predicts ${pct(wp)} (median), and ${pct(sm)} over ${still.length} where it predicts less than ${TOLERANCE_PCT} %: ${wm - sm >= TOLERANCE_PCT ? 'the drift follows the temperature' : 'seeing and altitude move the HFR as much as the temperature does'}.`;
	} else text += ` Too few intervals between runs on either side of ${TOLERANCE_PCT} % predicted growth to compare the drift (${warm.length} and ${still.length}, needs ${MIN_CHECK_MOVES} of each).`;
	const cooled = drift.filter((d) => d.airDeltaC !== null && d.deltaC !== 0);
	if (cooled.length) {
		const focuser = median(cooled.map((d) => Math.abs(d.deltaC)));
		const air = median(cooled.map((d) => Math.abs(d.airDeltaC!)));
		text += ` Where the focuser's reading changed (${cooled.length} intervals, ${degrees(focuser)} median) Open-Meteo's air temperature changed ${degrees(air)}${air < focuser / 2 ? ': the focuser follows the tube cooling down, not the air, so a forecast cannot stand in for it' : ''}.`;
	}
	return { text, verdict };
}

/**
 * Everything the advice rests on: the V-curve fits and their tolerance, the temperature coefficient (fitFocus),
 * the ASIAIR's triggers, and the frames' check. `frames` from the session reports, `air` Open-Meteo's hourly
 * temperature at the site over the nights (for the drift intervals).
 */
export function analyseFocus(runs: AutofocusRun[], frames: CheckFrame[], air: [number, number][] = []): FocusAnalysis {
	const ok = runs.filter((r) => r.success);
	const fits = ok.map(fitVCurve).filter((f): f is VCurveFit => f !== null);
	const byAt = new Map(fits.map((f) => [f.at, f]));
	const tolerances = fits.map((f) => f.toleranceSteps);
	const fit = fitFocus(runs);
	const moves = refocusMoves(runs, frames, byAt);
	const drift = fit.slope !== null ? driftChecks(hfrDrift(runs, frames), byAt, fit.slope, air) : [];
	const hfrNoisePct = hfrNoise(frames);
	const { text, verdict } = checkTexts(moves, drift, hfrNoisePct);
	const analysis: FocusAnalysis = {
		fits,
		unfitted: ok.filter((r) => r.points.some((p) => p[2] === 1)).length - fits.length,
		toleranceSteps: tolerances.length ? quantile(tolerances, 0.5) : null,
		toleranceQ1: tolerances.length ? quantile(tolerances, 0.25) : null,
		toleranceQ3: tolerances.length ? quantile(tolerances, 0.75) : null,
		fit,
		triggers: asiairTriggers(runs),
		moves,
		drift,
		hfrNoisePct,
		check: text,
		verdict,
		advice: null
	};
	analysis.advice = focusAdvice(analysis);
	return analysis;
}

/**
 * The ASIAIR setting to recommend: it refocuses after a change of more than its setting (set to 2 °C it fired at
 * 3 °C each of the 4 times in the logs) on a reading in whole degrees, so a setting N refocuses at N + 1 °C; the
 * largest N with N + 1 within the tolerance, at least 1.
 */
export const recommendedTrigger = (toleranceDegC: number) => Math.max(FOCUSER_RESOLUTION_C, Math.floor(toleranceDegC) - FOCUSER_RESOLUTION_C);

/** The advice in numbers and plain English; null when there is no tolerance or no coefficient to build it on. */
export function focusAdvice(a: Omit<FocusAnalysis, 'advice'>): FocusAdvice | null {
	const { fit, triggers: tr, toleranceSteps } = a;
	if (toleranceSteps === null || fit.slope === null || fit.slopeSe === null || fit.caveat !== null || fit.slope === 0) return null;
	const perC = Math.abs(fit.slope);
	const toleranceDegC = toleranceSteps / perC;
	const parts: string[] = [];
	parts.push(
		`Refocus every ${degrees(toleranceDegC)}: focus moves ${perC.toFixed(1)} ± ${fit.slopeSe.toFixed(1)} steps per °C and stars grow ${TOLERANCE_PCT} % ${steps(toleranceSteps)} from best (median of ${a.fits.length} V-curves, quartiles ${Math.round(a.toleranceQ1!)}–${Math.round(a.toleranceQ3!)}).`
	);
	const rec = recommendedTrigger(toleranceDegC);
	const asiair = tr.contradictedNight === null ? tr.temperatureDegC : null;
	if (asiair !== null) {
		const fired = tr.firedAtC.length ? ` (it fired at ${[...new Set(tr.firedAtC)].join('/')} °C, ${tr.temperatureRuns} times, last on ${tr.temperatureNight})` : '';
		const effective = Math.max(asiair + FOCUSER_RESOLUTION_C, ...tr.firedAtC);
		// How large the stars were when it fired: the frames at those runs, else the median curve.
		const seen = a.moves.filter((m) => parseTrigger(m.reason).kind === 'temperature').map((m) => m.measuredPct);
		const larger = seen.length
			? `the frames' stars were ${Math.round(Math.min(...seen))}–${pct(Math.max(...seen))} larger by then`
			: `stars are ~${pct(growthPct(effective * perC, quantile(a.fits.map((f) => f.halfWidth), 0.5)))} larger by then`;
		if (effective <= toleranceDegC) parts.push(`The ASIAIR refocuses after more than ${asiair} °C${fired}: that is close enough.`);
		else
			parts.push(
				`The ASIAIR refocuses after more than ${asiair} °C${fired}; ${larger}: set it to ${rec} °C${toleranceDegC < FOCUSER_RESOLUTION_C + rec ? `, the least it can do (the focuser reads whole degrees, so it refocuses at ${rec + FOCUSER_RESOLUTION_C} °C)` : ''}.`
			);
	} else if (tr.temperatureDegC !== null) parts.push(`The ASIAIR's temperature trigger (${tr.temperatureDegC} °C, last on ${tr.temperatureNight}) did not fire on ${tr.contradictedNight} when the temperature changed more: switch it on at ${rec} °C.`);
	else parts.push(`No run in the logs was triggered by temperature: switch the ASIAIR's temperature trigger on at ${rec} °C.`);
	if (tr.hours !== null && tr.betweenRunsC.length)
		parts.push(`It also refocuses every ${tr.hours} h; between runs the temperature changed ${degrees(quantile(tr.betweenRunsC, 0.5))} (median), at most ${degrees(Math.max(...tr.betweenRunsC))}.`);
	parts.push(a.verdict);
	return {
		stepsPerDegC: Math.round(fit.slope * 10) / 10,
		stepsPerDegCErr: Math.round(fit.slopeSe * 10) / 10,
		toleranceSteps: Math.round(toleranceSteps),
		toleranceDegC: Math.round(toleranceDegC * 10) / 10,
		asiairTriggerDegC: asiair,
		summary: parts.join(' ')
	};
}
