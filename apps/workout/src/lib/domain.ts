// People, machines, distances and calendar weeks. Pure: shared by the browser, the server and
// scripts/import-sheet.ts (which imports it by relative path, so no `$lib` imports here).

export const PEOPLE = [
	{ id: 'jari', name: 'Jari' },
	{ id: 'elina', name: 'Elina' }
] as const;
export type PersonId = (typeof PEOPLE)[number]['id'];

/** `short` matches the Google Sheet's column prefixes (TR, CT, R). */
export const MACHINES = [
	{ id: 'treadmill', name: 'Treadmill', short: 'TR' },
	{ id: 'crosstrainer', name: 'Cross trainer', short: 'CT' },
	{ id: 'rowing', name: 'Rowing', short: 'R' }
] as const;
export type MachineId = (typeof MACHINES)[number]['id'];

export const isPerson = (v: unknown): v is PersonId => PEOPLE.some((p) => p.id === v);
export const isMachine = (v: unknown): v is MachineId => MACHINES.some((m) => m.id === v);
export const personName = (id: PersonId) => PEOPLE.find((p) => p.id === id)?.name ?? id;
export const machineName = (id: MachineId) => MACHINES.find((m) => m.id === id)?.name ?? id;

/** Upper bound for one workout; also a CHECK constraint in the database. */
export const MAX_METERS = 100_000;

/** Distance per machine, in meters. */
export type Split = Record<MachineId, number>;

export const emptySplit = (): Split => ({ treadmill: 0, crosstrainer: 0, rowing: 0 });
export const splitTotal = (s: Split) => s.treadmill + s.crosstrainer + s.rowing;

/** "10", "10.5", "10,5" or "10 km" -> meters; null if not a sensible distance. */
export function parseKm(input: string): number | null {
	const s = input.trim().replace(/\s*km$/i, '').replace(',', '.');
	if (!/^\d{1,3}(\.\d{1,3})?$/.test(s)) return null;
	const meters = Math.round(Number(s) * 1000);
	return meters > 0 && meters <= MAX_METERS ? meters : null;
}

/** 10000 -> "10", 6320 -> "6.32", 9200 -> "9.2" (at most `decimals`, trailing zeros dropped). */
export function formatKm(meters: number, decimals = 2): string {
	return String(Number((meters / 1000).toFixed(decimals)));
}

// Dates are ISO strings (YYYY-MM-DD) throughout; arithmetic in UTC so time zones never shift a day.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const toDate = (iso: string) => new Date(`${iso}T00:00:00Z`);
const fromDate = (d: Date) => d.toISOString().slice(0, 10);

export function isIsoDate(v: unknown): v is string {
	return typeof v === 'string' && DATE_RE.test(v) && fromDate(toDate(v)) === v;
}

export function addDays(iso: string, days: number): string {
	const d = toDate(iso);
	d.setUTCDate(d.getUTCDate() + days);
	return fromDate(d);
}

/** 0 = Monday ... 6 = Sunday. */
export const weekday = (iso: string) => (toDate(iso).getUTCDay() + 6) % 7;

/** Monday of the week containing `iso`. */
export const weekStart = (iso: string) => addDays(iso, -weekday(iso));

/** ISO 8601 week: weeks start on Monday; week 1 is the one containing the year's first Thursday. */
export function isoWeek(iso: string): { year: number; week: number } {
	const thursday = addDays(iso, 3 - weekday(iso));
	const year = Number(thursday.slice(0, 4));
	const week = Math.floor((toDate(thursday).getTime() - toDate(`${year}-01-01`).getTime()) / 86_400_000 / 7) + 1;
	return { year, week };
}

/** Monday of ISO week `week` of ISO year `year`. */
export function isoWeekStart(year: number, week: number): string {
	return addDays(weekStart(`${year}-01-04`), (week - 1) * 7);
}

export const isoWeeksInYear = (year: number) => isoWeek(`${year}-12-28`).week;

/** Today in `timeZone` as YYYY-MM-DD. */
export function today(timeZone: string, now = new Date()): string {
	return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

export const daysInMonth = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** "2026-03-09" -> "9.3." (Finnish day.month). */
export const shortDate = (iso: string) => `${Number(iso.slice(8, 10))}.${Number(iso.slice(5, 7))}.`;
/** "2026-03-09" -> "Mon 9.3." */
export const dayLabel = (iso: string) => `${WEEKDAYS[weekday(iso)]} ${shortDate(iso)}`;
