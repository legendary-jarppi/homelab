// D6: statistics across sessions (hours per month, season and year, acceptance, rejection reasons) and
// clear nights from hourly cloud cover (ERA5) during darkness. Pure: runs on the server and in the page.
import { nightNoon, sky } from './sky';
import type { ClearMonth, ClearNight, RejectKind, SessionSummary } from './types';

const HOUR_S = 3600;
/** A night counts as clear with at least this many dark hours of cloud ≤ CLEAR_PCT. */
export const CLEAR_NIGHT_HOURS = 3;

export const REJECT_LABELS: Record<RejectKind, string> = {
	stars: 'Few stars (clouds)',
	background: 'Bright background',
	hfr: 'Large HFR (focus, seeing)',
	elongation: 'Elongated stars (trailing, wind)',
	guiding: 'Guiding RMS',
	alignment: 'Not aligned',
	manual: 'Rejected by hand',
	unreadable: 'Unreadable file',
	other: 'Other'
};

export interface PeriodRow {
	key: string;
	label: string;
	acceptedS: number;
	rejectedS: number;
	nights: number;
	sessions: number;
	frames: number;
	accepted: number;
	rejected: number;
}

/** "2026-10-17" → "2026-10". */
export const monthOf = (night: string) => night.slice(0, 7);

/** Every month from `first` to `last` ("YYYY-MM"), both included. */
export function monthsBetween(first: string, last: string): string[] {
	const out: string[] = [];
	let [y, m] = first.split('-').map(Number);
	const [ly, lm] = last.split('-').map(Number);
	while (y < ly || (y === ly && m <= lm)) {
		out.push(`${y}-${String(m).padStart(2, '0')}`);
		if (++m > 12) {
			m = 1;
			y++;
		}
	}
	return out;
}

/** "2026-10" → "Oct 2026" (or "Oct" without the year). */
export function monthLabel(month: string, withYear = true): string {
	const [y, m] = month.split('-').map(Number);
	return new Date(y, m - 1, 1).toLocaleDateString('en-GB', { month: 'short', ...(withYear ? { year: 'numeric' } : {}) });
}

/** Meteorological season of a night: winter Dec–Feb (labelled by both years), spring Mar–May, summer Jun–Aug, autumn Sep–Nov. */
export function seasonOf(night: string): { key: string; label: string } {
	const [y, m] = night.split('-').map(Number);
	if (m === 12 || m <= 2) {
		const start = m === 12 ? y : y - 1;
		return { key: `${start}-12`, label: `Winter ${start}–${String(start + 1).slice(2)}` };
	}
	const [name, first] = m <= 5 ? ['Spring', '03'] : m <= 8 ? ['Summer', '06'] : ['Autumn', '09'];
	return { key: `${y}-${first}`, label: `${name} ${y}` };
}

/** Rows per period (`group` gives a session's key and label), oldest first. */
export function byPeriod(sessions: SessionSummary[], group: (s: SessionSummary) => { key: string; label: string }): PeriodRow[] {
	const rows = new Map<string, PeriodRow & { nightSet: Set<string> }>();
	for (const s of sessions) {
		const { key, label } = group(s);
		let r = rows.get(key);
		if (!r) rows.set(key, (r = { key, label, acceptedS: 0, rejectedS: 0, nights: 0, sessions: 0, frames: 0, accepted: 0, rejected: 0, nightSet: new Set() }));
		r.acceptedS += s.integrationS;
		r.rejectedS += s.rejectedS ?? 0;
		r.sessions++;
		r.frames += s.frames;
		r.accepted += s.accepted;
		r.rejected += s.rejected;
		r.nightSet.add(s.night);
	}
	return [...rows.values()]
		.sort((a, b) => a.key.localeCompare(b.key))
		.map(({ nightSet, ...r }) => ({ ...r, nights: nightSet.size }));
}

/** Rejected frames by first reason across sessions, most first. */
export function rejectionBreakdown(sessions: SessionSummary[]): { kind: RejectKind; label: string; frames: number }[] {
	const counts = new Map<RejectKind, number>();
	for (const s of sessions) for (const [kind, n] of Object.entries(s.rejectReasons ?? {}) as [RejectKind, number][]) counts.set(kind, (counts.get(kind) ?? 0) + n);
	return [...counts.entries()].map(([kind, frames]) => ({ kind, label: REJECT_LABELS[kind] ?? kind, frames })).sort((a, b) => b.frames - a.frames);
}

/** Every night ("YYYY-MM-DD", the evening's date) from `first` to `last`, both included. */
export function nightsBetween(first: string, last: string): string[] {
	const out: string[] = [];
	const end = Date.parse(`${last}T00:00:00Z`);
	for (let t = Date.parse(`${first}T00:00:00Z`); t <= end; t += 86_400_000) out.push(new Date(t).toISOString().slice(0, 10));
	return out;
}

/**
 * Clear nights from hourly cloud cover (unix s → %, instantaneous at the hour): the samples inside the
 * night's darkness (astronomical, else nautical; none in the light summer nights) at or under `clearPct`
 * count as clear hours. A night is clear with `minHours` of them, or half its samples when the darkness is
 * shorter (spring and late summer: astronomical darkness of 2–3 h). A night without a sample in its darkness,
 * or one the data does not cover completely (ERA5's delay of about six days), is unknown.
 */
export function clearNights(
	hours: { time: number[]; cloud: (number | null)[] },
	nights: string[],
	lat: number,
	lon: number,
	imaged: Set<string>,
	clearPct: number,
	minHours = CLEAR_NIGHT_HOURS
): ClearNight[] {
	const byTime = new Map<number, number | null>();
	hours.time.forEach((t, i) => byTime.set(t, hours.cloud[i]));
	return nights.map((night) => {
		const s = sky(lat, lon, nightNoon(night));
		const dark = s.astronomical ?? s.nautical;
		const base = { night, imaged: imaged.has(night) };
		if (!dark) return { ...base, darkHours: 0, clearHours: null, clear: null };
		let clearHours: number | null = 0;
		let samples = 0;
		for (let t = Math.ceil(dark.start / 1000 / HOUR_S) * HOUR_S; t * 1000 <= dark.end; t += HOUR_S) {
			const c = byTime.get(t);
			if (c === undefined || c === null) {
				clearHours = null;
				break;
			}
			samples++;
			if (c <= clearPct) clearHours++;
		}
		const known = clearHours !== null && samples > 0;
		return { ...base, darkHours: (dark.end - dark.start) / 3_600_000, clearHours: known ? clearHours : null, clear: known ? clearHours! >= Math.min(minHours, Math.ceil(samples / 2)) : null };
	});
}

/** Clear nights per month, for the given months (oldest first). */
export function clearByMonth(nights: ClearNight[], months: string[]): ClearMonth[] {
	const rows = new Map(months.map((month) => [month, { month, darkNights: 0, known: 0, clear: 0, clearImaged: 0, clearMissed: 0, imagedNotClear: 0, imaged: 0 }]));
	for (const n of nights) {
		const r = rows.get(monthOf(n.night));
		if (!r) continue;
		if (n.imaged) r.imaged++;
		if (n.darkHours > 0) r.darkNights++;
		if (n.clear === null) continue;
		r.known++;
		if (n.clear) {
			r.clear++;
			if (n.imaged) r.clearImaged++;
			else r.clearMissed++;
		} else if (n.imaged) r.imagedNotClear++;
	}
	return [...rows.values()];
}
