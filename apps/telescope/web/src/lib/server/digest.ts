// R6: the two push digests on apps/notify's topic `telescope-digest`, composed from what the app already
// knows and sent by the scheduler (scheduler.ts) started once per server (hooks.server.ts `init`; one
// replica):
//  - Tonight's pick (DIGEST_PICK_AT): the Conditions page's cloud models voting hour by hour, each weighted
//    by its day-ahead skill from C4 (forecastReport's leaderboard), give the clear hours in darkness; at
//    least PICK_MIN_CLEAR_H of them, and the planner's targets ranked by their hours above 30° while clear,
//    the moon, the goals and the current project give the pick, a runner-up, dew and wind from the
//    Conditions forecast, and calibration reminders from adviceReport().
//  - The morning report (DIGEST_REPORT_AT, or an hour after the night's last frame): per session of the
//    night its integration, rejections, guiding, focus drift, trails, sky brightness and best frame.
import { adviceReport } from './advice';
import { CLEAR_PCT, DEW_MARGIN_C, GUSTY_MS, MODELS, models, weather } from './conditions';
import { config, type Site } from './config';
import { forecastReport } from './history';
import { BODY_MAX, notifyConfigured, sendDigest } from './notify';
import { reason, Scheduler, type Composed, type DigestKind } from './scheduler';
import { upstreamJson } from './telescope';
import { appeal, catalog, findDso, normalizeId, type Dso } from '$lib/catalog';
import { formatDuration } from '$lib/format';
import { progressByTarget, targetKey, type TargetProgress } from '$lib/goals';
import { DEFAULT_MIN_ALTITUDE, nightDate, planNight, planTarget, WELL_PLACED_HOURS, type NightPlan, type TargetPlan } from '$lib/planner';
import { nightNoon } from '$lib/sky';
import type { CalibrationItem, Digest, Frame, ModelScore, RejectKind, SessionDetail, SessionSummary, Targets } from '$lib/types';

const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** A model's day-ahead hit rate weighs only from this many judged hours; with fewer models than two there, all weigh the same. */
const MIN_JUDGED_HOURS = 24;
/** A model's weight is its hit rate above a coin toss (0.5), at least this. */
const SKILL_FLOOR = 0.05;
/** An hour is clear when the models calling it clear (cloud ≤ CLEAR_PCT) carry at least this share of the weight. */
const CLEAR_SHARE = 0.5;
/** Sessions this recent (days) with an unfinished goal, or no goal, make their target a current project. */
const PROJECT_DAYS = 14;
/** …if they gathered at least this much (s): a test shot is no project. */
const PROJECT_MIN_S = 1800;
/** Ranking factors on the planner's score × appeal. */
const PROJECT_FACTOR = 3;
const GOAL_FACTOR = 2;
const WISHLIST_FACTOR = 1.5;
const GOAL_REACHED_FACTOR = 0.3;
/** Appeal of a target outside the catalog (imaged under its own name). */
const UNKNOWN_APPEAL = 0.8;
/** Calibration reminders in a pick. */
const MAX_CALIBRATION = 2;
/** The report waits until no frame came for this long (s) after the night's last one. */
const REPORT_QUIET_S = 3600;
/** HFR first hour against last hour: from this change (%) the report gives focus advice. */
const HFR_DRIFT_PCT = 10;
/** The first and last stretch of a session compared for the drift (s); sessions shorter than twice this are not compared. */
const DRIFT_SPAN_S = 3600;
/** Scheduler tick; the first one shortly after start. */
const TICK_MS = 5 * MIN;
const FIRST_TICK_MS = 30_000;
const ZONE = 'Europe/Helsinki';

const HM = new Intl.DateTimeFormat('en-GB', { timeZone: ZONE, hourCycle: 'h23', hour: '2-digit', minute: '2-digit' });
const clock = (ms: number) => HM.format(ms);
const hourOf = (ms: number) => HM.format(ms).slice(0, 2);
const DAY_LABEL = new Intl.DateTimeFormat('en-GB', { timeZone: ZONE, weekday: 'short', day: 'numeric', month: 'short' });
const pct = (fraction: number) => `${Math.round(fraction * 100)} %`;
const hours = (h: number) => `${h >= 10 ? Math.round(h) : h.toFixed(1)} h`;

/** The instant of a local time (minutes after midnight) on a date; correct across the DST changes. */
export function localTime(date: string, minutes: number): number {
	const guess = nightNoon(date) + (minutes - 12 * 60) * MIN;
	const [h, m] = HM.format(guess).split(':').map(Number);
	let diff = minutes - (h * 60 + m);
	if (diff > 720) diff -= 1440;
	if (diff < -720) diff += 1440;
	return guess + diff * MIN;
}
const previousDate = (date: string) => nightDate(nightNoon(date) - DAY);

// ——— Tonight's pick ———

interface Weights {
	weight: Record<string, number>;
	note: string;
}

/** C4's day-ahead leaderboard as vote weights. */
function modelWeights(leaderboard: ModelScore[]): Weights {
	const judged = leaderboard.flatMap((m) => (m.hours >= MIN_JUDGED_HOURS && m.hitRate !== null ? [{ ...m, hitRate: m.hitRate }] : []));
	if (judged.length < 2) {
		const most = Math.max(0, ...leaderboard.map((m) => m.hours));
		return { weight: Object.fromEntries(MODELS.map((m) => [m.id, 1])), note: `models weighted equally (only ${most} judged hours so far)` };
	}
	const weight = Object.fromEntries(MODELS.map((m) => [m.id, SKILL_FLOOR]));
	for (const m of judged) weight[m.id] = Math.max(SKILL_FLOOR, m.hitRate - 0.5);
	return { weight, note: `weighted by day-ahead hits over ${Math.max(...judged.map((m) => m.hours))} h: ${judged.map((m) => `${m.label.replace(/ \(.*\)$/, '')} ${pct(m.hitRate)}`).join(', ')}` };
}

interface ClearNight {
	dark: { start: number; end: number };
	/** Clear hours in darkness (partial hours at its ends count by their share). */
	clearHours: number;
	/** The longest clear run, clipped to darkness. */
	best: { start: number; end: number } | null;
	isClear: (t: number) => boolean;
}

/** The weighted vote per hour over the night's darkness. */
function clearNight(dark: { start: number; end: number }, data: { time: number[]; models: { id: string; total: (number | null)[] }[] }, weights: Weights): ClearNight {
	const clearHour = new Set<number>();
	let clearHours = 0;
	let best: { start: number; end: number } | null = null;
	let run: { start: number; end: number } | null = null;
	data.time.forEach((t, i) => {
		if (t + HOUR <= dark.start || t >= dark.end) return;
		let all = 0;
		let clear = 0;
		for (const m of data.models) {
			const cloud = m.total[i];
			if (cloud === null) continue;
			const w = weights.weight[m.id] ?? SKILL_FLOOR;
			all += w;
			if (cloud <= CLEAR_PCT) clear += w;
		}
		const start = Math.max(t, dark.start);
		const end = Math.min(t + HOUR, dark.end);
		if (all > 0 && clear / all >= CLEAR_SHARE) {
			clearHour.add(t);
			clearHours += (end - start) / HOUR;
			run = run && run.end === start ? { start: run.start, end } : { start, end };
			if (!best || run.end - run.start > best.end - best.start) best = run;
		} else run = null;
	});
	return { dark, clearHours, best, isClear: (t) => clearHour.has(Math.floor(t / HOUR) * HOUR) };
}

interface Candidate {
	name: string;
	/** Planner link query and calibration match. */
	id: string;
	dso: Dso | null;
	progress: TargetProgress | undefined;
	plan: TargetPlan;
	score: number;
	why: string[];
}

/** Current projects: targets of recent sessions (not Live) whose goal, if any, is not reached yet. */
function projectKeys(progress: TargetProgress[], now: number): Set<string> {
	const since = now / 1000 - PROJECT_DAYS * 86_400;
	const out = new Set<string>();
	for (const p of progress) {
		const recentS = p.sessions.filter((s) => s.mode !== 'Live' && s.lastFrameAt >= since).reduce((sum, s) => sum + s.integrationS, 0);
		const reached = p.goal?.goalHours != null && p.integrationS >= p.goal.goalHours * 3600;
		if (recentS >= PROJECT_MIN_S && !reached) out.add(p.key);
	}
	return out;
}

function rank(night: NightPlan, sky: ClearNight, progress: TargetProgress[], now: number): Candidate[] {
	// The planner's numbers counted only in the clear hours of darkness.
	const clearPlan: NightPlan = { ...night, inWindow: night.inWindow.map((w, i) => w && sky.isClear(night.times[i])) };
	const byKey = new Map(progress.map((p) => [p.key, p]));
	const projects = projectKeys(progress, now);
	const illumination = night.sky.moon.illumination;
	const candidates: { name: string; id: string; dso: Dso | null; ra: number; dec: number; progress: TargetProgress | undefined }[] = catalog.map((o) => ({ name: o.id, id: o.id, dso: o, ra: o.ra, dec: o.dec, progress: byKey.get(targetKey(o.id)) }));
	for (const p of progress) if (!p.dso && p.ra !== null && p.dec !== null) candidates.push({ name: p.targetNames[0] ?? p.key, id: p.targetNames[0] ?? p.key, dso: null, ra: p.ra, dec: p.dec, progress: p });
	const out: Candidate[] = [];
	for (const c of candidates) {
		const plan = planTarget(c, clearPlan, DEFAULT_MIN_ALTITUDE);
		if (plan.hours < Math.min(WELL_PLACED_HOURS, sky.clearHours)) continue;
		const p = c.progress;
		const why: string[] = [];
		let factor = 1;
		const goalH = p?.goal?.goalHours ?? null;
		const doneH = (p?.integrationS ?? 0) / 3600;
		if (goalH !== null && doneH >= goalH) {
			factor *= GOAL_REACHED_FACTOR;
			why.push(`goal of ${hours(goalH)} reached`);
		} else {
			if (p && projects.has(p.key)) {
				factor *= PROJECT_FACTOR;
				why.push(`current project, ${hours(doneH)} so far`);
			}
			if (goalH !== null) {
				factor *= GOAL_FACTOR;
				why.push(`needs ${hours(goalH - doneH)} more`);
			}
		}
		if (p?.goal?.wishlist) {
			factor *= WISHLIST_FACTOR;
			why.push('on the wishlist');
		}
		// The planner samples every 10 min from the step before darkness: never more than the clear hours.
		why.push(`${hours(Math.min(plan.hours, sky.clearHours))} above ${DEFAULT_MIN_ALTITUDE}° while clear`);
		why.push(illumination < 0.05 ? 'no moon' : plan.moonUp ? `moon ${pct(illumination)}, ${Math.round(plan.moonDistance)}° away` : `moon ${pct(illumination)} but down`);
		out.push({ name: c.name, id: c.id, dso: c.dso, progress: p, plan, score: plan.score * (c.dso ? appeal(c.dso) : UNKNOWN_APPEAL) * factor, why });
	}
	return out.sort((a, b) => b.score - a.score);
}

/** Calibration reminders for the target (its ASIAIR names or catalog id) and those for every target. */
function reminders(items: CalibrationItem[], pick: Candidate): string[] {
	const names = new Set([pick.id, ...(pick.progress?.targetNames ?? [])].map(normalizeId));
	return items
		.filter((c) => c.level === 'warn' && (!c.target || names.has(normalizeId(c.target)) || (pick.dso !== null && findDso(c.target)?.id === pick.dso.id)))
		.slice(0, MAX_CALIBRATION)
		.map((c) => c.text);
}

async function composePick(site: Site, night: string, now: number): Promise<Composed> {
	const dueAt = Math.round(localTime(night, config.digest.pickAt) / 1000);
	const url = `${config.digest.link}/conditions`;
	const skip = (reason: string): Composed => ({ send: false, reason, title: '', body: '', url, dueAt });
	const plan = planNight(site, nightNoon(night));
	if (!plan.window) return skip(`no darkness on the night of ${night}`);
	const [sessions, goals, cloud] = await Promise.all([upstreamJson<SessionSummary[]>('/api/sessions', 'telescope'), upstreamJson<Targets>('/api/targets', 'telescope'), models(site)]);
	if (!sessions) throw new Error('telescope service unavailable');
	if (!cloud.data) throw new Error(`cloud models unavailable: ${cloud.error}`);
	if (!cloud.data.time.some((t) => t >= plan.window!.start && t < plan.window!.end)) return skip(`no forecast reaches the night of ${night}`);
	const [report, hourly, advice] = await Promise.all([forecastReport(site, sessions), weather(site), adviceReport()]);
	const weights = modelWeights(report.leaderboard.dayAhead);
	const sky = clearNight(plan.window, cloud.data, weights);
	const darkH = (plan.window.end - plan.window.start) / HOUR;
	const darkText = `${plan.darkness === 'astronomical' ? 'astronomical' : 'nautical'} darkness ${clock(plan.window.start)}–${clock(plan.window.end)}`;
	if (sky.clearHours < config.digest.pickMinClearH || !sky.best)
		return skip(`${sky.clearHours.toFixed(1)} clear hours in ${darkText} (needs ${config.digest.pickMinClearH}; ${weights.note})`);
	const ranked = rank(plan, sky, progressByTarget(sessions, goals?.targets ?? {}), now);
	if (!ranked.length) return skip(`clear ${sky.clearHours.toFixed(1)} h, but no target is ${WELL_PLACED_HOURS} h above ${DEFAULT_MIN_ALTITUDE}° while clear`);
	const [pick, runnerUp] = ranked;
	const best = sky.best;
	const lines = [
		`Clear ${clock(best.start)}–${clock(best.end)}: ${sky.clearHours.toFixed(1)} of ${darkH.toFixed(1)} dark hours clear (${weights.note}).`,
		`${pick.dso?.names[0] ? `${pick.name} (${pick.dso.names[0]})` : pick.name}: ${pick.why.join(', ')}.`
	];
	if (runnerUp) lines.push(`Runner-up: ${runnerUp.name} (${runnerUp.why.slice(0, 2).join(', ')}).`);
	const during = (hourly.data ?? []).filter((h) => h.time + HOUR > best.start && h.time < best.end);
	const dew = during.find((h) => h.temperature !== null && h.dewPoint !== null && h.temperature - h.dewPoint <= DEW_MARGIN_C);
	const gusts = Math.max(0, ...during.map((h) => h.gusts ?? 0));
	const weatherNotes = [...(dew ? [`dew likely from ${clock(Math.max(dew.time, best.start))}`] : []), ...(gusts > GUSTY_MS ? [`gusts to ${gusts.toFixed(0)} m/s`] : [])];
	if (weatherNotes.length) lines.push(`${weatherNotes.join(', ').replace(/^./, (c) => c.toUpperCase())}.`);
	// Reminders only as far as they fit whole into apps/notify's body limit.
	for (const text of reminders(advice.calibration, pick)) if ([...lines, `Calibration: ${text}`].join('\n').length <= BODY_MAX) lines.push(`Calibration: ${text}`);
	return {
		send: true,
		reason: null,
		title: `Clear tonight ${hourOf(best.start)}–${hourOf(best.end)}: ${pick.name}`,
		body: lines.join('\n'),
		url: `${config.digest.link}/planner?q=${encodeURIComponent(pick.id)}`,
		dueAt
	};
}

// ——— Morning report ———

/** Short words for the service's rejection kinds (`rejectReasons` keys). */
const REJECT_WORDS: Record<string, string> = {
	stars: 'clouds',
	background: 'bright sky',
	hfr: 'focus or seeing',
	elongation: 'trailing',
	guiding: 'guiding',
	alignment: 'not aligned',
	manual: 'by hand',
	unreadable: 'unreadable',
	other: 'other'
} satisfies Record<RejectKind, string>;

/** SkyExposure's sky brightness (mag/arcsec²) of a session or frame, where the service has it. */
function skyMagOf(value: object | null): number | null {
	return value && 'skyMag' in value && typeof value.skyMag === 'number' ? value.skyMag : null;
}

const median = (v: number[]) => {
	const s = [...v].sort((a, b) => a - b);
	return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

/** Median HFR of the accepted frames in the first and the last DRIFT_SPAN_S, or null for a short session. */
function hfrDrift(frames: Frame[]): { first: number; last: number; pct: number } | null {
	const ok = frames.filter((f) => f.accepted && f.hfr !== null);
	if (!ok.length) return null;
	const start = Math.min(...ok.map((f) => f.at));
	const end = Math.max(...ok.map((f) => f.at + (f.exposureS ?? 0)));
	if (end - start < 2 * DRIFT_SPAN_S) return null;
	const first = median(ok.filter((f) => f.at < start + DRIFT_SPAN_S).map((f) => f.hfr!));
	const last = median(ok.filter((f) => f.at + (f.exposureS ?? 0) > end - DRIFT_SPAN_S).map((f) => f.hfr!));
	return { first, last, pct: ((last - first) / first) * 100 };
}

/** The best accepted frame by the reference score: stars (capped at 1.25 × the median) per HFR. */
function bestFrame(frames: Frame[]): Frame | null {
	const ok = frames.filter((f) => f.accepted && f.hfr && f.stars);
	if (!ok.length) return null;
	const cap = 1.25 * median(ok.map((f) => f.stars!));
	const score = (f: Frame) => Math.min(f.stars!, cap) / f.hfr!;
	return ok.reduce((a, b) => (score(b) > score(a) ? b : a));
}

function sessionLine(s: SessionSummary, d: SessionDetail | null): { text: string; drift: number | null } {
	const analysed = s.accepted + s.rejected;
	const parts = [`${s.target} ${clock(s.firstFrameAt * 1000)}–${clock(s.lastFrameAt * 1000)}: ${formatDuration(s.integrationS)} in ${s.accepted} of ${analysed} frames`];
	if (s.rejected) {
		const reasons = Object.entries(s.rejectReasons ?? {})
			.sort((a, b) => b[1] - a[1])
			.slice(0, 2)
			.map(([kind, n]) => `${REJECT_WORDS[kind] ?? kind} ${n}`);
		parts.push(`${s.rejected} rejected${reasons.length ? ` (${reasons.join(', ')})` : ''}`);
	}
	const rms = s.guidingRmsArcsec ?? d?.guiding?.rmsArcsec ?? null;
	if (rms !== null) parts.push(`guiding ${rms.toFixed(1)}″`);
	const drift = d ? hfrDrift(d.frames) : null;
	if (drift) parts.push(`HFR ${drift.first.toFixed(2)} → ${drift.last.toFixed(2)} first to last hour (${drift.pct >= 0 ? '+' : '−'}${Math.abs(drift.pct).toFixed(0)} %)`);
	else if (s.hfr != null) parts.push(`HFR ${s.hfr.toFixed(2)}`);
	const skyMag = skyMagOf(d) ?? skyMagOf(s);
	if (skyMag != null) parts.push(`sky ${skyMag.toFixed(2)} mag/arcsec²`);
	if (d?.trails?.frames) parts.push(`trails in ${d.trails.frames} ${d.trails.frames === 1 ? 'frame' : 'frames'}`);
	let text = `${parts.join(', ')}.`;
	const best = d ? bestFrame(d.frames) : null;
	if (best) {
		const frameSky = skyMagOf(best);
		const numbers = [`HFR ${best.hfr!.toFixed(2)}`, `${best.stars} stars`, ...(best.fwhmPx != null ? [`FWHM ${best.fwhmPx.toFixed(1)} px`] : []), ...(best.guidingRmsArcsec != null ? [`guiding ${best.guidingRmsArcsec.toFixed(1)}″`] : []), ...(frameSky != null ? [`sky ${frameSky.toFixed(2)}`] : [])];
		text += ` Best frame${best.number !== null ? ` #${best.number}` : ''} at ${clock(best.at * 1000)}: ${numbers.join(', ')}.`;
	}
	return { text, drift: drift?.pct ?? null };
}

async function composeReport(night: string): Promise<Composed> {
	const sessions = await upstreamJson<SessionSummary[]>('/api/sessions', 'telescope');
	if (!sessions) throw new Error('telescope service unavailable');
	const ofNight = sessions.filter((s) => s.night === night && s.accepted + s.rejected > 0);
	const nominal = Math.round(localTime(nightDate(nightNoon(night) + DAY + HOUR), config.digest.reportAt) / 1000);
	if (!ofNight.length) return { send: false, reason: `no frames on the night of ${night}`, title: '', body: '', url: `${config.digest.link}/sessions`, dueAt: nominal };
	const lastFrame = Math.max(...ofNight.map((s) => s.lastFrameAt));
	const dueAt = ofNight.some((s) => s.active) ? null : Math.max(nominal, Math.round(lastFrame + REPORT_QUIET_S));
	const main = ofNight.filter((s) => s.mode !== 'Live').sort((a, b) => b.integrationS - a.integrationS);
	const live = ofNight.filter((s) => s.mode === 'Live');
	const details = await Promise.all(main.map((s) => upstreamJson<SessionDetail>(`/api/sessions/${encodeURIComponent(s.id)}`, 'telescope', 20_000)));
	const lines: string[] = [];
	const grew: string[] = [];
	main.forEach((s, i) => {
		const line = sessionLine(s, details[i]);
		lines.push(line.text);
		if (line.drift !== null && line.drift >= HFR_DRIFT_PCT) grew.push(`${s.target} +${line.drift.toFixed(0)} %`);
	});
	if (grew.length) {
		const focus = (await adviceReport()).focus;
		// One line: the advice's first sentence (the whole is on /stats/focus).
		if (focus) lines.push(`Focus (HFR grew: ${grew.join(', ')}): ${focus.summary.split(/(?<=\.)\s/)[0]}`);
	}
	if (live.length) lines.push(`Live: ${live.map((s) => `${s.target} (${s.accepted + s.rejected} ${s.accepted + s.rejected === 1 ? 'frame' : 'frames'})`).join(', ')}.`);
	const head = main.length ? main : live;
	const titleParts = head.map((s) => `${s.target} ${hours(s.integrationS / 3600)}`);
	const totalS = ofNight.reduce((sum, s) => sum + s.integrationS, 0);
	return {
		send: true,
		reason: null,
		title: `${DAY_LABEL.format(nightNoon(night))}: ${titleParts.join(', ')}${head.length > 1 ? ` (${hours(totalS / 3600)})` : ''}`,
		body: lines.join('\n'),
		url: `${config.digest.link}/sessions/${encodeURIComponent(head[0].id)}`,
		dueAt
	};
}

// ——— Sent markers (the service's /api/notices) ———

async function getNotice(key: string): Promise<number | null> {
	if (!config.telescopeUrl) throw new Error('TELESCOPE_URL not set');
	const response = await fetch(`${config.telescopeUrl}/api/notices/${key}`, { signal: AbortSignal.timeout(10_000) });
	if (response.status === 404) return null;
	if (!response.ok) throw new Error(`notices: HTTP ${response.status}`);
	const body: unknown = await response.json();
	if (body && typeof body === 'object' && 'sentAt' in body && typeof body.sentAt === 'number') return body.sentAt;
	throw new Error('notices: no sentAt in the answer');
}

async function putNotice(key: string, sentAt: number): Promise<void> {
	if (!config.telescopeUrl) throw new Error('TELESCOPE_URL not set');
	const response = await fetch(`${config.telescopeUrl}/api/notices/${key}`, {
		method: 'PUT',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ sentAt }),
		signal: AbortSignal.timeout(10_000)
	});
	if (!response.ok) throw new Error(`notices: HTTP ${response.status}`);
}

// ——— Entry points ———

export async function composeDigest(kind: DigestKind, night: string, now = Date.now()): Promise<Composed> {
	if (!config.site) throw new Error('TELESCOPE_SITE not set');
	return kind === 'pick' ? composePick(config.site, night, now) : composeReport(night);
}

/** What the digest for a night would say now (nothing is sent). Default nights: tonight's pick, the newest night with frames. */
export async function previewDigest(kind: DigestKind, night?: string): Promise<Digest> {
	const now = Date.now();
	let target = night;
	if (!target) {
		if (kind === 'pick') target = nightDate(nightNoon(now));
		else target = (await upstreamJson<SessionSummary[]>('/api/sessions', 'telescope'))?.find((s) => s.accepted + s.rejected > 0)?.night ?? previousDate(nightDate(now));
	}
	const composed = await composeDigest(kind, target, now);
	const sentAt = await getNotice(`${kind}:${target}`).catch(() => null);
	return { kind, night: target, ...composed, sentAt, notifyConfigured: notifyConfigured(), generatedAt: Math.round(now / 1000) };
}

let started = false;

/** Start the scheduler once per server process (hooks.server.ts `init`). */
export function startDigests(): void {
	if (started) return;
	started = true;
	if (!config.site) {
		console.log('digest: TELESCOPE_SITE not set, no digests');
		return;
	}
	const scheduler = new Scheduler({
		now: () => Date.now(),
		localDate: (ms) => nightDate(ms),
		localTime,
		previousDate,
		pickAt: config.digest.pickAt,
		reportAt: config.digest.reportAt,
		windowMs: config.digest.windowMin * MIN,
		compose: (kind, night) => composeDigest(kind, night),
		getNotice,
		putNotice,
		canSend: notifyConfigured,
		send: async (message) => {
			const result = await sendDigest(message);
			console.log(`digest: notify took "${message.title}": ${result.recipients} recipients, ${result.delivered} delivered`);
		},
		log: (message) => console.log(`digest ${message}`)
	});
	const tick = () => scheduler.tick().catch((e: unknown) => console.error(`digest tick: ${reason(e)}`));
	setTimeout(tick, FIRST_TICK_MS).unref();
	setInterval(tick, TICK_MS).unref();
	const t = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
	console.log(`digest: pick at ${t(config.digest.pickAt)}, report at ${t(config.digest.reportAt)} (${ZONE}), window ${config.digest.windowMin} min, pick needs ${config.digest.pickMinClearH} clear h; notify ${notifyConfigured() ? 'configured' : 'not configured'}`);
}
