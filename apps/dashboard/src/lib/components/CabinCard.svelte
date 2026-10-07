<script lang="ts">
	import CabinViewer from './CabinViewer.svelte';
	import Card from './Card.svelte';
	import { snapshotUrl } from '$lib/cabin';
	import { dayOf, eventTime } from '$lib/dates';
	import { night } from '$lib/night.svelte';
	import type { CabinData } from '$lib/types';

	/** The cabin camera's motion snapshots (FTPS uploads, apps/cabin-camera); null when unavailable. */
	let { cabin }: { cabin: CabinData | null } = $props();

	/** Index into `cabin.snapshots` open in the viewer. */
	let open = $state<number | null>(null);
	const latest = $derived(cabin?.snapshots[0] ?? null);
	const todayKey = $derived(dayOf(night.now.toISOString()));
	const today = $derived(cabin?.snapshots.filter((s) => dayOf(new Date(s.time).toISOString()) === todayKey).length ?? 0);
	/** Only the latest 24 are loaded: all of them from today means there may be more. */
	const todayLabel = $derived(cabin && today === cabin.snapshots.length && cabin.total > today ? `${today}+ today` : `${today} today`);
</script>

<Card title="Cabin">
	{#snippet accessory()}
		{#if today > 0}<span>{todayLabel}</span>{/if}
	{/snippet}
	{#if !cabin}
		<p class="muted">Cabin camera unavailable.</p>
	{:else if !latest}
		<p class="muted">No motion pictures yet.</p>
	{:else}
		<button class="shot" onclick={() => (open = 0)} aria-label="Cabin camera pictures">
			<img src={snapshotUrl(latest.path)} alt="Latest motion at the cabin" />
			<span class="time">{eventTime(new Date(latest.time).toISOString(), night.now)}</span>
		</button>
	{/if}
</Card>

{#if open !== null && cabin && cabin.snapshots.length > 0}
	<CabinViewer snapshots={cabin.snapshots} bind:index={open} onclose={() => (open = null)} />
{/if}

<style>
	p {
		margin: 0;
		font-size: 14px;
	}
	.shot {
		position: relative;
		flex: 1 1 auto;
		min-height: 0;
		aspect-ratio: 16 / 9;
		padding: 0;
		border: 0;
		border-radius: 14px;
		overflow: hidden;
		background: #000;
		cursor: pointer;
	}
	img {
		display: block;
		width: 100%;
		height: 100%;
		object-fit: cover;
	}
	.time {
		position: absolute;
		left: 10px;
		bottom: 10px;
		padding: 4px 10px;
		font-size: 13px;
		font-weight: 600;
		color: #fff;
		border-radius: 999px;
		background: rgba(0, 0, 0, 0.55);
		backdrop-filter: blur(6px);
		-webkit-backdrop-filter: blur(6px);
	}
</style>
