// Aggregation of per-day totals into buckets (weeks, months, years). Pure, shared by server and pages.
import { PEOPLE, emptySplit, isPerson, type MachineId, type PersonId, type Split } from './domain.ts';

/** Sum of one person's workouts on one machine on one day (`workouts` grouped by day, person, machine). */
export interface DayRow {
	day: string;
	person: PersonId;
	machine: MachineId;
	meters: number;
	count: number;
}

export interface PersonTotals {
	split: Split;
	count: number;
}
export type Bucket = Record<PersonId, PersonTotals>;

export function emptyBucket(): Bucket {
	return Object.fromEntries(PEOPLE.map((p) => [p.id, { split: emptySplit(), count: 0 }])) as Bucket;
}

/**
 * One bucket per key, in the given order (empty buckets included). `keyOf` maps a day to its key;
 * rows whose key is not listed are ignored.
 */
export function bucketize<K extends string>(rows: DayRow[], keys: readonly K[], keyOf: (day: string) => string): Record<K, Bucket> {
	const out = Object.fromEntries(keys.map((k) => [k, emptyBucket()])) as Record<K, Bucket>;
	for (const row of rows) {
		const bucket = out[keyOf(row.day) as K];
		if (!bucket) continue;
		bucket[row.person].split[row.machine] += row.meters;
		bucket[row.person].count += row.count;
	}
	return out;
}

/** Stats pages' `?p=` filter: one person, or everyone when missing or unknown. */
export function selectedPeople(param: string | null): PersonId[] {
	return isPerson(param) ? [param] : PEOPLE.map((p) => p.id);
}
