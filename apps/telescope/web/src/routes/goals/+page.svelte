<script lang="ts">
	import { untrack } from 'svelte';
	import Card from '$lib/components/Card.svelte';
	import GoalRow from '$lib/components/GoalRow.svelte';
	import { FinalsData } from '$lib/finals.svelte';
	import { formatDuration } from '$lib/format';
	import { progressByTarget } from '$lib/goals';
	import { DEFAULT_MIN_ALTITUDE, planNight } from '$lib/planner';
	import { nightNoon } from '$lib/sky';
	import { TargetStore } from '$lib/targets.svelte';

	/**
	 * C5: accepted integration per target across every night, against a goal: progress, how much more is
	 * needed, whether the target is well placed tonight (the planner's numbers), and its final stacks.
	 */
	let { data } = $props();

	const store = new TargetStore(
		untrack(() => data.targets),
		untrack(() => data.targetsError)
	);
	const finals = new FinalsData(
		untrack(() => data.finals),
		untrack(() => data.finalsError)
	);
	$effect(() => finals.poll());

	type Filter = 'goals' | 'all' | 'wishlist';
	let filter = $state<Filter>('goals');
	const rows = $derived(progressByTarget(data.sessions, store.targets));
	const withGoal = $derived(rows.filter((r) => r.goal?.goalHours));
	const shown = $derived.by(() => {
		if (filter === 'all') return rows;
		if (filter === 'wishlist') return rows.filter((r) => r.goal?.wishlist);
		// Unfinished goals first (least left first), then reached ones.
		const left = (r: (typeof rows)[number]) => r.goal!.goalHours! * 3600 - r.integrationS;
		return [...withGoal].sort((a, b) => Number(left(a) <= 0) - Number(left(b) <= 0) || left(a) - left(b));
	});
	const night = $derived(data.site ? planNight(data.site, nightNoon(Date.now())) : null);
	const total = $derived(rows.reduce((sum, r) => sum + r.integrationS, 0));
	const goalLeft = $derived(withGoal.reduce((sum, r) => sum + Math.max(0, r.goal!.goalHours! * 3600 - r.integrationS), 0));
	const FILTERS: [Filter, string][] = [
		['goals', 'With a goal'],
		['wishlist', 'Wishlist'],
		['all', 'All targets']
	];
</script>

<svelte:head><title>Goals · Telescope</title></svelte:head>

<main>
	<Card title="Integration goals">
		{#snippet accessory()}<span class="num">{rows.length} targets</span>{/snippet}
		<p class="summary num">
			{formatDuration(total)} imaged over {new Set(data.sessions.map((s) => s.night)).size} nights{withGoal.length ? ` · ${withGoal.length} goals, ${Math.round(goalLeft / 3600)} h to go` : ''}
		</p>
		<p class="muted small">Accepted frames only. A session counts for the catalog object its target name names, or the one within 0.3° of its plate-solved centre. Tonight: hours above {DEFAULT_MIN_ALTITUDE}° in darkness (see the Planner).</p>
		<div class="chips">
			{#each FILTERS as [value, label] (value)}
				<button class="btn" class:on={filter === value} onclick={() => (filter = value)}>{label}</button>
			{/each}
		</div>
		{#if store.error}<p class="small warn">{store.error}</p>{/if}
		{#if finals.error}<p class="small muted">Final stacks: {finals.error}</p>{/if}
	</Card>

	{#if shown.length === 0}
		<Card><p class="muted">{filter === 'goals' ? 'No goals yet: set one under All targets, or on the Planner.' : filter === 'wishlist' ? 'Nothing on the wishlist (the star on the Planner).' : 'No sessions yet.'}</p></Card>
	{:else}
		<ul>
			{#each shown as row (row.key)}
				<li><GoalRow {row} {store} {night} finals={finals.list} /></li>
			{/each}
		</ul>
	{/if}
</main>

<style>
	main {
		display: flex;
		flex-direction: column;
		gap: var(--gap);
	}
	p {
		margin: 0;
	}
	.summary {
		font-size: 17px;
	}
	.small {
		font-size: 13px;
	}
	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}
	ul {
		margin: 0;
		padding: 0;
		list-style: none;
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(min(100%, 520px), 1fr));
		gap: var(--gap);
	}
</style>
