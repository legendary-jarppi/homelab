<script lang="ts">
	import { MACHINES, addDays, formatKm, personName, shortDate, splitTotal, type PersonId } from '$lib/domain';
	import type { Bucket } from '$lib/stats';

	interface Week {
		week: number;
		start: string;
		bucket: Bucket;
	}

	interface Props {
		/** Oldest first; shown newest first. */
		weeks: Week[];
		people: PersonId[];
		/** Monday of the current week (highlighted). */
		currentStart?: string;
		/** Running total column (year page; cumulative from the first listed week). */
		cumulative?: boolean;
	}

	let { weeks, people, currentStart, cumulative = false }: Props = $props();

	const single = $derived(people.length === 1 ? people[0] : null);

	/** Per listed week: running total for the single selected person. */
	const running = $derived.by(() => {
		let sum = 0;
		return weeks.map((w) => (sum += single ? splitTotal(w.bucket[single].split) : 0));
	});

	const sumOf = (pick: (w: Week) => number) => weeks.reduce((s, w) => s + pick(w), 0);
	const rows = $derived(weeks.map((w, i) => ({ w, run: running[i] })).reverse());
</script>

{#snippet km(meters: number)}
	<td class="num" class:zero={meters === 0}>{meters === 0 ? '–' : formatKm(meters, 1)}</td>
{/snippet}

<div class="scroll">
	<table class="data">
		<thead>
			<tr>
				<th>Week</th>
				{#if single}
					{#each MACHINES as m (m.id)}<th><span class="dot" style="background: var(--{m.id})"></span> {m.short}</th>{/each}
					<th>Total</th>
					{#if cumulative}<th>Cum.</th>{/if}
				{:else}
					{#each people as p (p)}<th>{personName(p)}</th>{/each}
				{/if}
			</tr>
		</thead>
		<tbody>
			{#each rows as { w, run } (w.start)}
				<tr class:current={w.start === currentStart}>
					<td><span class="wk num">{w.week}</span> <span class="muted dates">{shortDate(w.start)}–{shortDate(addDays(w.start, 6))}</span></td>
					{#if single}
						{#each MACHINES as m (m.id)}{@render km(w.bucket[single].split[m.id])}{/each}
						<td class="num total">{formatKm(splitTotal(w.bucket[single].split), 1)}</td>
						{#if cumulative}<td class="num muted">{formatKm(run, 1)}</td>{/if}
					{:else}
						{#each people as p (p)}{@render km(splitTotal(w.bucket[p].split))}{/each}
					{/if}
				</tr>
			{/each}
		</tbody>
		{#if weeks.length > 1}
			<tfoot>
				<tr>
					<td>Avg / week</td>
					{#if single}
						{#each MACHINES as m (m.id)}<td class="num">{formatKm(sumOf((w) => w.bucket[single].split[m.id]) / weeks.length, 1)}</td>{/each}
						<td class="num total">{formatKm(sumOf((w) => splitTotal(w.bucket[single].split)) / weeks.length, 1)}</td>
						{#if cumulative}<td></td>{/if}
					{:else}
						{#each people as p (p)}<td class="num">{formatKm(sumOf((w) => splitTotal(w.bucket[p].split)) / weeks.length, 1)}</td>{/each}
					{/if}
				</tr>
			</tfoot>
		{/if}
	</table>
</div>

<style>
	.scroll {
		overflow-x: auto;
	}
	.wk {
		display: inline-block;
		min-width: 1.6em;
		font-weight: 600;
	}
	.dates {
		font-size: 12px;
	}
	.total {
		font-weight: 600;
	}
	tfoot td {
		border-bottom: 0;
		color: var(--muted);
		font-size: 13px;
	}
</style>
