// R6: calibration reminders from the processor's library and its match of recent targets' lights (GET
// /api/library, /api/library/match). The match's groups (night, exposure, gain, offset, temperature, camera
// angle) and the masters it chose carry the processor's own decisions, and the limits below are its constants
// (apps/telescope/processor/src/library.py), so a reminder never contradicts a match warning: it says what to
// take to make the warning go away. Pure: advice.ts runs it, the Library page shows its constants.
import type { CalibrationGroup, CalibrationItem, Library, Master } from '$lib/types';

/** The processor's limits (library.py): camera angles match within this, modulo 180°. */
export const ANGLE_MATCH_DEG = 2;
/** library.py: flats more than this many days from the lights, darks and bias older than these, are flagged. */
export const FLAT_MAX_DAYS = 7;
export const DARK_MAX_DAYS = 180;
export const BIAS_MAX_DAYS = 365;
/** library.py: a dark matches the lights' temperature within this. */
export const TEMP_MATCH_C = 2;
/** Targets imaged within this many days count as recent (with a goal, every night counts). */
export const RECENT_DAYS = 30;
/** Calibration groups of fewer accepted lights are framing or test shots (one 30 s frame of Sh2-142 on 2026-10-19), not worth calibration. */
export const MIN_GROUP_FRAMES = 5;
/** How many frames to take: 20 darks and 30 bias (the noise of a master falls as 1/√N; the 2026-10-19 sets had 15 darks and 30 bias). */
export const TAKE_FRAMES: Record<'dark' | 'bias', number> = { dark: 20, bias: 30 };

/** A recent target's lights as the processor groups and calibrates them; `goal`: every night counts, not only recent ones. */
export interface TargetMatch {
	target: string;
	goal: boolean;
	groups: CalibrationGroup[];
	warnings: string[];
}

export interface CalibrationInput {
	masters: Master[];
	failed: NonNullable<Library['failed']>;
	targets: TargetMatch[];
	/** The camera's angle now: the newest session's last frame (FITS ROTATOR), and that session's night. */
	camera: { angleDeg: number; night: string } | null;
	/** Tonight, YYYY-MM-DD (the evening it starts). */
	today: string;
}

/** Processor warnings these reminders cover (the rest are passed on as they are). */
const COVERED = /^(No dark for |Dark at |Dark is |No flat:|Flat taken at |Flat is \d+ days |No bias for |Bias is )/;
const KIND_ORDER: Record<CalibrationItem['kind'], number> = { flat: 0, dark: 1, bias: 2, other: 3 };

const DAY_MS = 86_400_000;
const days = (a: string, b: string) => Math.round((Date.parse(`${a}T12:00:00Z`) - Date.parse(`${b}T12:00:00Z`)) / DAY_MS);
const addDays = (night: string, n: number) => new Date(Date.parse(`${night}T12:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);

/** library.py angle_diff: modulo 180° (before and after a meridian flip is one physical setup). */
export function angleDiff(a: number, b: number): number {
	const d = (((a - b) % 180) + 180) % 180;
	return Math.min(d, 180 - d);
}

const exposure = (s: number | null) => (s === null ? 'unknown exposure' : s < 1 ? `${+(s * 1000).toFixed(3)} ms` : `${+s.toFixed(3)} s`);
const temperature = (t: number | null) => (t === null ? 'unknown temperature' : `${Math.round(t) < 0 ? '−' : ''}${Math.abs(Math.round(t))} °C`);
const angle = (deg: number) => `${Math.round(deg)}°`;

/** "A", "A and B", "A, B and C". */
export function joinList(items: string[]): string {
	return items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
}

/** "C 9 and IC 1795 on 2026-10-17", "IC 1848 (2026-10-19), C 9 (2026-10-17)": targets with their nights. */
function whose(groups: { target: string; group: CalibrationGroup }[]): string {
	const byTarget = new Map<string, Set<string>>();
	for (const { target, group } of groups) byTarget.set(target, (byTarget.get(target) ?? new Set()).add(group.night));
	const nights = new Set(groups.map((g) => g.group.night));
	if (nights.size === 1) return `${joinList([...byTarget.keys()])} on ${[...nights][0]}`;
	return joinList([...byTarget].map(([t, n]) => `${t} (${[...n].sort().join(', ')})`));
}

const single = (groups: { target: string }[]) => {
	const targets = new Set(groups.map((g) => g.target));
	return targets.size === 1 ? { target: [...targets][0] } : {};
};

/**
 * Reminders, most actionable first (warnings before information; flats, darks, bias, the rest), de-duplicated:
 * - flats: lights whose flat is at another camera angle or more than FLAT_MAX_DAYS from them. At the camera's
 *   present angle and recent enough for new flats to count: take flats before turning it (warn); at another angle:
 *   only with the camera turned back exactly (info); too old for any new flat: said once (info). With every flat
 *   fine, a reminder when the flats at the present angle are older than FLAT_MAX_DAYS by tonight (info).
 * - darks: per exposure, gain, offset and temperature used, no dark of that exposure (none, or scaled from
 *   another), one at another temperature, or one more than DARK_MAX_DAYS older than the lights or than tonight.
 * - bias: none for a gain and offset used (needed for scaled darks and the flats), or older than BIAS_MAX_DAYS.
 * - everything else the processor warns about for these lights, and masters that failed to build, as they are.
 */
export function calibrationReminders(input: CalibrationInput): CalibrationItem[] {
	const { masters, today, camera } = input;
	const byId = new Map(masters.map((m) => [m.id, m]));
	const items: CalibrationItem[] = [];
	const groups = input.targets.flatMap((t) =>
		t.groups.filter((g) => g.frames >= MIN_GROUP_FRAMES && (t.goal || days(today, g.night) <= RECENT_DAYS)).map((group) => ({ target: t.target, group }))
	);

	// Flats.
	const flats = masters.filter((m) => m.type === 'flat');
	const flatOk = (g: CalibrationGroup) => {
		const flat = g.flat ? byId.get(g.flat) : undefined;
		if (!flat) return false;
		if (flat.rotatorDeg !== null && g.rotatorDeg !== null && angleDiff(flat.rotatorDeg, g.rotatorDeg) > ANGLE_MATCH_DEG) return false;
		return Math.abs(days(g.night, flat.night)) <= FLAT_MAX_DAYS;
	};
	const flatsAt = (deg: number) => flats.filter((m) => m.rotatorDeg !== null && angleDiff(m.rotatorDeg, deg) <= ANGLE_MATCH_DEG).sort((a, b) => b.night.localeCompare(a.night));
	const otherFlats = (deg: number) => {
		const at = flatsAt(deg)[0];
		if (at) return `the flats at this angle are from ${at.night}`;
		const others = [...flats].sort((a, b) => b.night.localeCompare(a.night));
		if (!others.length) return 'there are no flats';
		const list = joinList(others.slice(0, 3).map((m) => `${m.rotatorDeg === null ? 'an unknown angle' : angle(m.rotatorDeg)} (${m.night})`));
		return others.length === 1 ? `the only flats are at ${list}` : `the newest flats are at ${list}`;
	};
	const unflat = groups.filter((g) => !flatOk(g.group));
	const buckets: { deg: number; members: typeof unflat }[] = [];
	for (const g of unflat) {
		const deg = g.group.rotatorDeg ?? -1;
		const bucket = buckets.find((b) => (b.deg < 0 ? deg < 0 : deg >= 0 && angleDiff(b.deg, deg) <= ANGLE_MATCH_DEG));
		if (bucket) bucket.members.push(g);
		else buckets.push({ deg, members: [g] });
	}
	let presentFlagged = false;
	const lost: typeof unflat = [];
	for (const b of buckets) {
		const fixable = b.members.filter((g) => days(today, g.group.night) <= FLAT_MAX_DAYS);
		lost.push(...b.members.filter((g) => days(today, g.group.night) > FLAT_MAX_DAYS));
		if (!fixable.length) continue;
		const since = fixable.map((g) => g.group.night).sort()[0];
		const present = camera !== null && b.deg >= 0 && angleDiff(camera.angleDeg, b.deg) <= ANGLE_MATCH_DEG;
		if (b.deg < 0) {
			items.push({ level: 'warn', kind: 'flat', text: `Take flats with the camera as it is: ${whose(fixable)} have no camera angle in their headers and no flat within ${FLAT_MAX_DAYS} days.`, ...single(fixable) });
		} else if (present) {
			presentFlagged = true;
			const plural = new Set(fixable.map((g) => g.target)).size > 1 || fixable.length > 1;
			items.push({
				level: 'warn',
				kind: 'flat',
				text: `Take flats at ${angle(camera.angleDeg)} before turning the camera: ${whose(fixable)} ${plural ? 'have' : 'has'} no flat at this angle within ${FLAT_MAX_DAYS} days; ${otherFlats(b.deg)}. Flats taken by ${addDays(since, FLAT_MAX_DAYS)} count for ${plural ? 'all of them' : 'it'}.`,
				...single(fixable)
			});
		} else {
			items.push({
				level: 'info',
				kind: 'flat',
				text: `${whose(fixable)} at ${angle(b.deg)} ${fixable.length > 1 ? 'have' : 'has'} no flat at that angle; ${otherFlats(b.deg)}. Flats for these lights need the camera turned back to exactly ${angle(b.deg)}, by ${addDays(since, FLAT_MAX_DAYS)}.`,
				...single(fixable)
			});
		}
	}
	if (lost.length)
		items.push({
			level: 'info',
			kind: 'flat',
			text: `No new flat can match ${whose(lost)} any more (more than ${FLAT_MAX_DAYS} days ago, or at another angle): the processor uses the nearest flat it has and says so.`,
			...single(lost)
		});
	if (camera && !presentFlagged && groups.some((g) => g.group.rotatorDeg !== null && angleDiff(g.group.rotatorDeg, camera.angleDeg) <= ANGLE_MATCH_DEG)) {
		const newest = flatsAt(camera.angleDeg)[0];
		if (newest && days(today, newest.night) > FLAT_MAX_DAYS)
			items.push({ level: 'info', kind: 'flat', text: `The flats at ${angle(camera.angleDeg)} are from ${newest.night}, ${days(today, newest.night)} days ago: take new ones with the next lights (flats more than ${FLAT_MAX_DAYS} days from the lights are flagged).` });
	}

	// Darks, per setting used.
	const settings = new Map<string, { exposureS: number | null; gain: number | null; offset: number | null; tempC: number | null; members: typeof groups }>();
	for (const g of groups) {
		const t = g.group.tempC === null ? null : Math.round(g.group.tempC);
		const key = `${g.group.exposureS}|${g.group.gain}|${g.group.offset}|${t}`;
		const s = settings.get(key) ?? { exposureS: g.group.exposureS, gain: g.group.gain, offset: g.group.offset, tempC: t, members: [] };
		s.members.push(g);
		settings.set(key, s);
	}
	for (const s of settings.values()) {
		const what = `${exposure(s.exposureS)}${s.gain !== null ? `, gain ${s.gain}` : ''}, ${temperature(s.tempC)}`;
		const take = `take ${TAKE_FRAMES.dark}`;
		const missing = s.members.filter((g) => !g.group.dark);
		const scaled = s.members.filter((g) => g.group.dark && g.group.darkScaled);
		const warm = s.members.filter((g) => {
			const d = g.group.dark ? byId.get(g.group.dark) : undefined;
			return d && !g.group.darkScaled && d.tempC !== null && g.group.tempC !== null && Math.abs(d.tempC - g.group.tempC) > TEMP_MATCH_C;
		});
		if (missing.length || scaled.length) {
			const how = [
				scaled.length ? `${whose(scaled)} use${scaled.length === 1 && new Set(scaled.map((g) => g.target)).size === 1 ? 's' : ''} the ${exposure(byId.get(scaled[0].group.dark!)?.exposureS ?? null)} dark, scaled` : null,
				missing.length ? `${whose(missing)} ${missing.length === 1 ? 'has' : 'have'} hot pixels taken out of the lights themselves` : null
			].filter(Boolean);
			items.push({ level: 'warn', kind: 'dark', text: `No dark for ${what}: ${take} (${how.join('; ')}).`, ...single([...missing, ...scaled]) });
			continue;
		}
		if (warm.length) {
			const d = byId.get(warm[0].group.dark!)!;
			items.push({ level: 'warn', kind: 'dark', text: `The dark for ${what} was taken at ${temperature(d.tempC)}: ${take} at ${temperature(s.tempC)} (${whose(warm)}).`, ...single(warm) });
			continue;
		}
		const old = s.members.filter((g) => {
			const d = byId.get(g.group.dark!);
			return d && days(g.group.night, d.night) > DARK_MAX_DAYS;
		});
		const used = byId.get(s.members[0].group.dark!);
		if (old.length) {
			const d = byId.get(old[0].group.dark!)!;
			items.push({ level: 'warn', kind: 'dark', text: `The dark for ${what} is from ${d.night}, over ${DARK_MAX_DAYS} days before ${whose(old)}: ${take} new ones (hot pixels change).`, ...single(old) });
		} else if (used && days(today, used.night) > DARK_MAX_DAYS) {
			items.push({ level: 'warn', kind: 'dark', text: `The dark for ${what} is from ${used.night}, ${days(today, used.night)} days ago: ${take} new ones before the next lights (darks over ${DARK_MAX_DAYS} days older than the lights are flagged).` });
		}
	}

	// Bias, per gain and offset used.
	const signals = new Map(groups.map((g) => [`${g.group.gain}|${g.group.offset}`, g.group]));
	for (const g of signals.values()) {
		const what = g.gain !== null && g.offset !== null ? `gain ${g.gain}, offset ${g.offset}` : 'the lights’ gain and offset';
		const bias = masters.filter((m) => m.type === 'bias' && m.gain === g.gain && m.offset === g.offset).sort((a, b) => b.night.localeCompare(a.night))[0];
		if (!bias) items.push({ level: 'warn', kind: 'bias', text: `No bias for ${what}: take ${TAKE_FRAMES.bias} (scaled darks and the flats need one).` });
		else if (days(today, bias.night) > BIAS_MAX_DAYS)
			items.push({ level: 'warn', kind: 'bias', text: `The bias for ${what} is from ${bias.night}, ${days(today, bias.night)} days ago: take ${TAKE_FRAMES.bias} new ones (bias over ${BIAS_MAX_DAYS} days older than the lights is flagged).` });
	}

	// The processor's other warnings for these lights, and masters that failed.
	for (const t of input.targets) {
		for (const w of t.warnings) {
			const text = w.replace(/^\d{4}-\d{2}-\d{2}: /, '');
			if (!COVERED.test(text)) items.push({ level: 'info', kind: 'other', text: `${t.target}: ${w}`, target: t.target });
		}
	}
	for (const f of input.failed) items.push({ level: 'warn', kind: 'other', text: `The master of ${f.set} could not be built: ${f.error}` });

	const seen = new Set<string>();
	return items
		.filter((i) => !seen.has(i.text) && seen.add(i.text))
		.sort((a, b) => (a.level === b.level ? 0 : a.level === 'warn' ? -1 : 1) || KIND_ORDER[a.kind] - KIND_ORDER[b.kind]);
}
