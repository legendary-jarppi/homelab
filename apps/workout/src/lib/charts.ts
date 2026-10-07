import type { Bar } from './components/BarChart.svelte';
import { splitTotal, type PersonId } from './domain.ts';
import type { Bucket } from './stats.ts';

export interface PersonChart {
	person: PersonId;
	/** Shared by all charts of the set, so people compare at a glance. */
	max: number;
	bars: Bar[];
}

/** One bar chart per person over the same buckets, on a shared scale. */
export function chartsPerPerson<T extends { bucket: Bucket }>(
	items: T[],
	people: PersonId[],
	bar: (item: T, i: number) => Omit<Bar, 'split'>
): PersonChart[] {
	const max = Math.max(0, ...items.flatMap((it) => people.map((p) => splitTotal(it.bucket[p].split))));
	return people.map((person) => ({
		person,
		max,
		bars: items.map((it, i) => ({ ...bar(it, i), split: it.bucket[person].split }))
	}));
}
