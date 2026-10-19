<script lang="ts">
	import { untrack } from 'svelte';
	import { page } from '$app/state';
	import Card from '$lib/components/Card.svelte';
	import FinalActions from '$lib/components/FinalActions.svelte';
	import FinalItem from '$lib/components/FinalItem.svelte';
	import { FinalsData } from '$lib/finals.svelte';
	import { formatDuration } from '$lib/format';
	import { now } from '$lib/now.svelte';

	/**
	 * D3: final stacks (Siril on the processor: calibration, registration, every chosen night together):
	 * build one for a target, follow its progress, view and download the result; or download everything
	 * for processing by hand.
	 */
	let { data } = $props();

	const finals = new FinalsData(
		untrack(() => data.finals),
		untrack(() => data.finalsError)
	);
	$effect(() => now.use());
	$effect(() => finals.poll());

	const targetNames = $derived([...new Set(data.sessions.map((s) => s.target))]);
	let target = $state(untrack(() => page.url.searchParams.get('target') ?? data.sessions[0]?.target ?? ''));
	const sessions = $derived(data.sessions.filter((s) => s.target === target));
	const nights = $derived([...new Set(sessions.map((s) => s.night))]);
	const integration = $derived(sessions.reduce((sum, s) => sum + s.integrationS, 0));
	const active = $derived(finals.list.filter((f) => f.status === 'queued' || f.status === 'running'));
	const finished = $derived(finals.list.filter((f) => f.status === 'done' || f.status === 'failed'));
</script>

<svelte:head><title>Finals · Telescope</title></svelte:head>

<main>
	<div class="top">
		<Card title="Final stack">
			{#snippet accessory()}
				{#if targetNames.length}
					<select class="field" bind:value={target} aria-label="Target">
						{#if target && !targetNames.includes(target)}<option value={target}>{target}</option>{/if}
						{#each targetNames as n (n)}<option value={n}>{n}</option>{/each}
					</select>
				{/if}
			{/snippet}
			{#if !targetNames.length}
				<p class="muted">No sessions yet.</p>
			{:else if !nights.length}
				<p class="muted">No sessions of {target}.</p>
			{:else}
				<p class="num">{target}: {sessions.length} {sessions.length === 1 ? 'session' : 'sessions'} on {nights.length} {nights.length === 1 ? 'night' : 'nights'}, {formatDuration(integration)} accepted</p>
				<FinalActions {target} {nights} {finals} />
				<p class="muted small">
					<strong>Build</strong>: calibrated (the Library's masters), registered and stacked with Siril over the chosen nights; one at a time, a newer request for the same target replaces a queued one. <strong>Download</strong>: an uncompressed tar with the raw lights by night (exactly as archived), the bias, dark and flat sets used and their masters, the latest final, and a README with every frame, why rejected ones were left out, and the calibration match.
				</p>
			{/if}
			{#if finals.error}<p class="small warn">{finals.error}</p>{/if}
		</Card>
	</div>

	{#if active.length}
		<Card title="Running and queued">
			<ul>{#each active as f (f.id)}<li><FinalItem final={f} nowMs={now.ms} /></li>{/each}</ul>
		</Card>
	{/if}
	<Card title="Finished">
		{#snippet accessory()}<span class="num">{finished.length}</span>{/snippet}
		{#if finished.length}
			<ul>{#each finished as f (f.id)}<li><FinalItem final={f} nowMs={now.ms} /></li>{/each}</ul>
		{:else}
			<p class="muted">{data.finals ? 'No final stacks yet.' : `Unavailable${data.finalsError ? `: ${data.finalsError}` : ''}.`}</p>
		{/if}
	</Card>
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
	.small {
		font-size: 13px;
	}
	ul {
		margin: 0;
		padding: 0;
		list-style: none;
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(min(100%, 520px), 1fr));
		gap: 16px 20px;
	}
</style>
