<script lang="ts">
	import Card from './Card.svelte';
	import MotionTile from './MotionTile.svelte';
	import MotionViewer from './MotionViewer.svelte';
	import { cabinEvents } from '$lib/cabin';
	import { dayOf, eventTime } from '$lib/dates';
	import { night } from '$lib/night.svelte';
	import type { CabinData } from '$lib/types';

	/** The cabin camera's pictures and clips (FTPS uploads, apps/cabin-camera); null when unavailable. */
	let { cabin }: { cabin: CabinData | null } = $props();

	/** Index into `events` open in the viewer. */
	let open = $state<number | null>(null);
	const events = $derived(cabin ? cabinEvents(cabin.snapshots) : []);
	const todayKey = $derived(dayOf(night.now.toISOString()));
	const today = $derived(events.filter((e) => dayOf(new Date(e.time).toISOString()) === todayKey).length);
	/** Only the latest files are loaded: all of them from today means there may be more. */
	const more = $derived(cabin !== null && today === events.length && cabin.total > cabin.snapshots.length);
	const caption = (time: number) => eventTime(new Date(time).toISOString(), night.now);
</script>

<Card title="Cabin">
	{#snippet accessory()}
		{#if today > 0}<span>{today}{more ? '+' : ''} today</span>{/if}
	{/snippet}
	{#if !cabin}
		<p class="muted">Cabin camera unavailable.</p>
	{:else if events.length === 0}
		<p class="muted">No motion pictures yet.</p>
	{:else}
		<div class="latest">
			<MotionTile item={events[0]} caption={caption(events[0].time)} onopen={() => (open = 0)} />
		</div>
		{#if events.length > 1}
			<div class="earlier">
				{#each events.slice(1) as e, i (e.key)}
					<MotionTile item={e} caption={caption(e.time)} onopen={() => (open = i + 1)} />
				{/each}
			</div>
		{/if}
	{/if}
</Card>

{#if open !== null && events.length > 0}
	<MotionViewer items={events} bind:index={open} label="Cabin camera pictures and clips" onclose={() => (open = null)} />
{/if}

<style>
	p {
		margin: 0;
		font-size: 14px;
	}
	.latest {
		flex: none;
	}
	/* Earlier events below the latest; scrolls inside the card when it has a fixed height. */
	.earlier {
		flex: 1 1 auto;
		min-height: 0;
		max-height: 420px;
		overflow-y: auto;
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
		align-content: start;
		gap: 8px;
		scrollbar-width: none;
	}
	.earlier::-webkit-scrollbar {
		display: none;
	}
	@media (min-width: 1000px) and (min-aspect-ratio: 5/4) {
		.earlier {
			max-height: none;
		}
	}
</style>
