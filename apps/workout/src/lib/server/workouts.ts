// Workout storage and the summaries built on it.
import { addDays, isoWeek, isoWeekStart, isoWeeksInYear, weekStart, type MachineId, type PersonId } from '$lib/domain';
import { bucketize, type Bucket, type DayRow } from '$lib/stats';
import type { Sql } from './db';

/** Day of the oldest workout (where browsing back stops), or null when there are none. */
export async function firstDay(sql: Sql): Promise<string | null> {
	const [row] = await sql<{ day: string | null }[]>`SELECT min(day) AS day FROM workouts`;
	return row.day;
}

export interface Workout {
	id: number;
	person: PersonId;
	machine: MachineId;
	day: string;
	meters: number;
}

export interface WorkoutInput {
	person: PersonId;
	machine: MachineId;
	day: string;
	meters: number;
}

export async function addWorkout(sql: Sql, w: WorkoutInput): Promise<number> {
	const [row] = await sql`
		INSERT INTO workouts (person, machine, day, meters) VALUES (${w.person}, ${w.machine}, ${w.day}, ${w.meters})
		RETURNING id`;
	return row.id as number;
}

export async function updateWorkout(sql: Sql, id: number, w: WorkoutInput): Promise<boolean> {
	const rows = await sql`
		UPDATE workouts SET person = ${w.person}, machine = ${w.machine}, day = ${w.day}, meters = ${w.meters}, updated_at = now()
		WHERE id = ${id} RETURNING id`;
	return rows.length > 0;
}

export async function deleteWorkout(sql: Sql, id: number): Promise<boolean> {
	return (await sql`DELETE FROM workouts WHERE id = ${id} RETURNING id`).length > 0;
}

export async function getWorkout(sql: Sql, id: number): Promise<Workout | null> {
	const [row] = await sql<Workout[]>`SELECT id, person, machine, day, meters FROM workouts WHERE id = ${id}`;
	return row ?? null;
}

/** Newest first by workout day, then by entry order. */
export async function recentWorkouts(sql: Sql, limit: number): Promise<Workout[]> {
	return sql<Workout[]>`SELECT id, person, machine, day, meters FROM workouts ORDER BY day DESC, id DESC LIMIT ${limit}`;
}

export async function workoutsBetween(sql: Sql, from: string, to: string): Promise<Workout[]> {
	return sql<Workout[]>`
		SELECT id, person, machine, day, meters FROM workouts WHERE day BETWEEN ${from} AND ${to} ORDER BY day DESC, id DESC`;
}

/** Each person's most recently entered machine (default for the next entry). */
export async function lastMachines(sql: Sql): Promise<Partial<Record<PersonId, MachineId>>> {
	const rows = await sql<{ person: PersonId; machine: MachineId }[]>`
		SELECT DISTINCT ON (person) person, machine FROM workouts ORDER BY person, created_at DESC, id DESC`;
	return Object.fromEntries(rows.map((r) => [r.person, r.machine]));
}

/** Per-day sums for `from`..`to` inclusive. */
export async function dayRows(sql: Sql, from: string, to: string): Promise<DayRow[]> {
	return sql<DayRow[]>`
		SELECT day, person, machine, sum(meters)::int AS meters, count(*)::int AS count
		FROM workouts WHERE day BETWEEN ${from} AND ${to}
		GROUP BY day, person, machine`;
}

export interface YearRow {
	year: number;
	bucket: Bucket;
}

/** Calendar-year totals for every year with workouts, oldest first. */
export async function yearTotals(sql: Sql): Promise<YearRow[]> {
	const rows = await sql<DayRow[]>`
		SELECT to_char(day, 'YYYY') || '-01-01' AS day, person, machine, sum(meters)::int AS meters, count(*)::int AS count
		FROM workouts GROUP BY 1, person, machine`;
	const years = [...new Set(rows.map((r) => r.day.slice(0, 4)))].sort();
	const buckets = bucketize(rows, years, (day) => day.slice(0, 4));
	return years.map((y) => ({ year: Number(y), bucket: buckets[y] }));
}

export interface WeekRow {
	year: number;
	week: number;
	/** Monday. */
	start: string;
	bucket: Bucket;
}

/** Full ISO weeks overlapping `from`..`to`, oldest first. */
export async function weeksCovering(sql: Sql, from: string, to: string): Promise<WeekRow[]> {
	const weeks: Omit<WeekRow, 'bucket'>[] = [];
	for (let start = weekStart(from); start <= to; start = addDays(start, 7)) {
		weeks.push({ ...isoWeek(start), start });
	}
	if (weeks.length === 0) return [];
	const rows = await dayRows(sql, weeks[0].start, addDays(weeks[weeks.length - 1].start, 6));
	const buckets = bucketize(rows, weeks.map((w) => w.start), weekStart);
	return weeks.map((w) => ({ ...w, bucket: buckets[w.start] }));
}

/** ISO weeks of ISO year `year` up to and including the week of `today` (all of them for past years). */
export async function weeksOfYear(sql: Sql, year: number, today: string): Promise<WeekRow[]> {
	const current = isoWeek(today);
	if (year > current.year) return [];
	const last = year === current.year ? current.week : isoWeeksInYear(year);
	return weeksCovering(sql, isoWeekStart(year, 1), isoWeekStart(year, last));
}

export interface Overview {
	today: string;
	thisWeek: WeekRow;
	lastWeek: WeekRow;
	/** Calendar year to date. */
	yearToDate: Bucket;
}

/**
 * Current and previous week plus year to date, per person (the log page's "This week" card).
 */
export async function overview(sql: Sql, today: string): Promise<Overview> {
	const [lastWeek, thisWeek] = await weeksCovering(sql, addDays(today, -7), today);
	const year = today.slice(0, 4);
	const ytd = bucketize(await dayRows(sql, `${year}-01-01`, today), [year], (day) => day.slice(0, 4));
	return { today, thisWeek, lastWeek, yearToDate: ytd[year] };
}
