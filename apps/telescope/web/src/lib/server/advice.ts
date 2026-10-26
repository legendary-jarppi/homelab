// R6: focus advice and calibration reminders (/stats/focus, /library, Live, the digests). Built from the service's
// auto focus runs and session reports, Open-Meteo's temperature at the site, and the processor's library and
// matches; kept for ADVICE_TTL_MS. Never throws: a source that does not answer leaves its part null or empty,
// with the reason logged.
import { analyseFocus, type CheckFrame, type FocusAnalysis } from '$lib/focus';
import { calibrationReminders, RECENT_DAYS, type TargetMatch } from '$lib/calibration';
import { sessionKey } from '$lib/goals';
import { nightDate } from '$lib/planner';
import { nightNoon } from '$lib/sky';
import type { AdviceReport, CalibrationItem, FocusReport, Library, LibraryMatch, SessionDetail, SessionSummary, Targets } from '$lib/types';
import { config } from './config';
import { upstreamJson } from './telescope';
import { siteTemperature } from './temperature';

/** Both parts are rebuilt at most this often. */
const ADVICE_TTL_MS = 10 * 60_000;
/** Session reports are read this many at a time. */
const DETAIL_CONCURRENCY = 4;
/** Air temperature fetched around a night's frames, s. */
const AIR_MARGIN_S = 3600;

/** A failed part is built again after this, not after ADVICE_TTL_MS (as cache.ts retries a source). */
const RETRY_MS = 60_000;

/**
 * A value rebuilt at most every ADVICE_TTL_MS (callers share one build in flight); a build that calls `failed()`
 * expires after RETRY_MS. `builtAt()`: when the current one was started, unix ms.
 */
function every<T>(build: (failed: () => void) => Promise<T>): (() => Promise<T>) & { builtAt: () => number } {
	let at = 0;
	let ttl = ADVICE_TTL_MS;
	let value: Promise<T> | null = null;
	const get = () => {
		if (!value || Date.now() - at > ttl) {
			at = Date.now();
			ttl = ADVICE_TTL_MS;
			value = build(() => (ttl = RETRY_MS));
		}
		return value;
	};
	return Object.assign(get, { builtAt: () => at });
}

async function need<T>(what: string, value: Promise<T | null>): Promise<T> {
	const v = await value;
	if (v === null) throw new Error(`${what} unavailable`);
	return v;
}

async function details(sessions: SessionSummary[]): Promise<SessionDetail[]> {
	const out: SessionDetail[] = [];
	for (let i = 0; i < sessions.length; i += DETAIL_CONCURRENCY) {
		const batch = await Promise.all(sessions.slice(i, i + DETAIL_CONCURRENCY).map((s) => upstreamJson<SessionDetail>(`/api/sessions/${encodeURIComponent(s.id)}`, 'telescope', 15_000)));
		for (const d of batch) if (d) out.push(d);
	}
	return out;
}

/**
 * The focus analysis (src/lib/focus.ts analyseFocus) on every auto focus run, the frames of the nights with two
 * successful runs or more, and Open-Meteo's hourly temperature over those nights. Null when the service does not answer.
 */
export const focusAnalysis = every(async (failed): Promise<FocusAnalysis | null> => {
	try {
		const [focus, sessions] = await Promise.all([need('Focus runs', upstreamJson<FocusReport>('/api/focus', 'telescope', 15_000)), need('Sessions', upstreamJson<SessionSummary[]>('/api/sessions', 'telescope'))]);
		const perNight: Record<string, number> = {};
		for (const r of focus.runs) if (r.success && r.night) perNight[r.night] = (perNight[r.night] ?? 0) + 1;
		const wanted = sessions.filter((s) => (perNight[s.night] ?? 0) >= 2);
		const reports = await details(wanted);
		const frames: CheckFrame[] = reports.flatMap((d) => d.frames.map((f) => ({ at: f.at, exposureS: f.exposureS, hfr: f.hfr, focusPos: f.focusPos ?? null, session: d.id })));
		const air: [number, number][] = [];
		if (config.site) {
			const site = config.site;
			const nights = new Map<string, [number, number]>();
			for (const s of wanted) {
				const w = nights.get(s.night);
				nights.set(s.night, [Math.min(w?.[0] ?? Infinity, s.firstFrameAt - AIR_MARGIN_S), Math.max(w?.[1] ?? -Infinity, s.lastFrameAt + AIR_MARGIN_S)]);
			}
			const series = await Promise.all([...nights.values()].map(([from, to]) => siteTemperature(site, from, to)));
			for (const s of series) if (s.data) air.push(...s.data);
			const missing = series.filter((s) => !s.data).length;
			if (missing) {
				console.error(`advice: Open-Meteo temperature missing for ${missing} nights`);
				failed();
			}
			air.sort((a, b) => a[0] - b[0]);
		}
		return analyseFocus(focus.runs, frames, air);
	} catch (e) {
		console.error(`advice: focus: ${e instanceof Error ? e.message : String(e)}`);
		failed();
		return null;
	}
});

/**
 * Calibration reminders (src/lib/calibration.ts) for the targets imaged in the last RECENT_DAYS days or with a
 * goal: the processor's match for each (one request per target), its library, and the camera's angle from the
 * newest session's last frame. Empty when the processor or the service does not answer.
 */
const calibration = every(async (failed): Promise<CalibrationItem[]> => {
	try {
		if (!config.processorUrl) throw new Error('PROCESSOR_URL not set');
		const [library, sessions, goals] = await Promise.all([
			need('Library', upstreamJson<Library>('/api/library', 'processor')),
			need('Sessions', upstreamJson<SessionSummary[]>('/api/sessions', 'telescope')),
			upstreamJson<Targets>('/api/targets', 'telescope')
		]);
		const today = nightDate(nightNoon(Date.now()));
		const recentFrom = Date.now() / 1000 - RECENT_DAYS * 86_400;
		const withGoal = new Set(Object.entries(goals?.targets ?? {}).flatMap(([key, g]) => (g.goalHours !== null ? [key] : [])));
		const names = new Map<string, boolean>();
		for (const s of sessions) {
			const goal = withGoal.has(sessionKey(s));
			if (goal || s.lastFrameAt >= recentFrom) names.set(s.target, (names.get(s.target) ?? false) || goal);
		}
		const targets: TargetMatch[] = [];
		const matches = await Promise.all([...names.keys()].map((t) => upstreamJson<LibraryMatch>(`/api/library/match?target=${encodeURIComponent(t)}`, 'processor', 30_000)));
		[...names].forEach(([target, goal], i) => {
			const m = matches[i];
			if (m) targets.push({ target, goal, groups: m.nights ?? [], warnings: m.warnings });
			else {
				console.error(`advice: calibration match for ${target} unavailable`);
				failed();
			}
		});
		const newest = [...sessions].sort((a, b) => b.lastFrameAt - a.lastFrameAt)[0];
		const report = newest ? await upstreamJson<SessionDetail>(`/api/sessions/${encodeURIComponent(newest.id)}`, 'telescope', 15_000) : null;
		if (newest && !report) {
			console.error('advice: newest session report unavailable (no camera angle)');
			failed();
		}
		const angleDeg = report?.frames.findLast((f) => f.rotatorDeg !== null && f.rotatorDeg !== undefined)?.rotatorDeg ?? null;
		return calibrationReminders({
			masters: library.masters,
			failed: library.failed ?? [],
			targets,
			camera: angleDeg !== null && report ? { angleDeg, night: report.night } : null,
			today
		});
	} catch (e) {
		console.error(`advice: calibration: ${e instanceof Error ? e.message : String(e)}`);
		failed();
		return [];
	}
});

/** Focus advice and calibration reminders, at most ADVICE_TTL_MS old (`generatedAt`: the older part's build, unix s); never throws. */
export async function adviceReport(): Promise<AdviceReport> {
	const [analysis, items] = await Promise.all([focusAnalysis(), calibration()]);
	return { focus: analysis?.advice ?? null, calibration: items, generatedAt: Math.round(Math.min(focusAnalysis.builtAt(), calibration.builtAt()) / 1000) };
}
