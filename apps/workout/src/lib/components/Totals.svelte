<script lang="ts">
	import { MACHINES, formatKm, splitTotal } from '$lib/domain';
	import type { PersonTotals } from '$lib/stats';

	let { name, totals, note }: { name: string; totals: PersonTotals; note?: string } = $props();

	const total = $derived(splitTotal(totals.split));
</script>

<div class="totals">
	<div class="head">
		<h3>{name}</h3>
		<span class="muted">{totals.count} {totals.count === 1 ? 'workout' : 'workouts'}</span>
	</div>
	<div class="big num">{formatKm(total, 1)}<small> km</small></div>
	<div class="bar" aria-hidden="true">
		{#each MACHINES as m (m.id)}
			{#if totals.split[m.id] > 0}
				<span style="flex: {totals.split[m.id]}; background: var(--{m.id})"></span>
			{/if}
		{/each}
	</div>
	<ul>
		{#each MACHINES as m (m.id)}
			<li class:zero={totals.split[m.id] === 0}>
				<span class="name"><span class="dot" style="background: var(--{m.id})"></span> {m.name}</span>
				<span class="num">{formatKm(totals.split[m.id], 1)}&nbsp;km</span>
			</li>
		{/each}
	</ul>
	{#if note}<p class="muted note">{note}</p>{/if}
</div>

<style>
	.totals {
		display: grid;
		gap: 8px;
		min-width: 0;
	}
	.head {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		gap: 8px;
		font-size: 13px;
	}
	h3 {
		font-size: 16px;
	}
	.big {
		font-size: 34px;
		font-weight: 650;
		line-height: 1;
	}
	.big small {
		font-size: 15px;
		font-weight: 500;
		color: var(--muted);
	}
	.bar {
		display: flex;
		gap: 2px;
		height: 6px;
		border-radius: 3px;
		overflow: hidden;
		background: var(--surface-strong);
	}
	ul {
		margin: 0;
		padding: 0;
		list-style: none;
		display: grid;
		gap: 4px;
		font-size: 14px;
	}
	li {
		display: flex;
		justify-content: space-between;
		gap: 8px;
		white-space: nowrap;
	}
	.name {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	li.zero {
		color: var(--faint);
	}
	.note {
		margin: 0;
		font-size: 13px;
	}
</style>
