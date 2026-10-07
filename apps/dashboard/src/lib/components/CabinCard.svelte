<script lang="ts">
	import CabinViewer from './CabinViewer.svelte';
	import Card from './Card.svelte';
	import { cabinEvents, snapshotUrl } from '$lib/cabin';
	import { dayOf, eventTime } from '$lib/dates';
	import { night } from '$lib/night.svelte';
	import type { CabinData } from '$lib/types';

	/** The cabin camera's pictures and clips (FTPS uploads, apps/cabin-camera); null when unavailable. */
	let { cabin }: { cabin: CabinData | null } = $props();

	/** Index into `events` open in the viewer. */
	let open = $state<number | null>(null);
	const events = $derived(cabin ? cabinEvents(cabin.snapshots) : []);
	const latest = $derived(events[0] ?? null);
	const todayKey = $derived(dayOf(night.now.toISOString()));
	const today = $derived(events.filter((e) => dayOf(new Date(e.time).toISOString()) === todayKey).length);
	/** Only the latest files are loaded: all of them from today means there may be more. */
	const more = $derived(cabin !== null && today === events.length && cabin.total > cabin.snapshots.length);
</script>

<Card title="Cabin">
	{#snippet accessory()}
		{#if today > 0}<span>{today}{more ? '+' : ''} today</span>{/if}
	{/snippet}
	{#if !cabin}
		<p class="muted">Cabin camera unavailable.</p>
	{:else if !latest}
		<p class="muted">No motion pictures yet.</p>
	{:else}
		<button class="shot" onclick={() => (open = 0)} aria-label="Cabin camera pictures and clips">
			{#if latest.image}
				<img src={snapshotUrl(latest.image.path)} alt="Latest motion at the cabin" />
			{:else if latest.video}
				<!-- A clip without its picture: its first frame stands in. -->
				<video src="{snapshotUrl(latest.video.path)}#t=0.1" muted playsinline preload="metadata"></video>
			{/if}
			<span class="time">{eventTime(new Date(latest.time).toISOString(), night.now)}</span>
			{#if latest.video}
				<span class="play" aria-label="Has a video clip">
					<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
				</span>
			{/if}
		</button>
	{/if}
</Card>

{#if open !== null && events.length > 0}
	<CabinViewer {events} bind:index={open} onclose={() => (open = null)} />
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
	img,
	video {
		display: block;
		width: 100%;
		height: 100%;
		object-fit: cover;
		pointer-events: none;
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
	.play {
		position: absolute;
		right: 10px;
		bottom: 10px;
		width: 30px;
		height: 30px;
		display: grid;
		place-items: center;
		border-radius: 50%;
		background: rgba(0, 0, 0, 0.55);
		backdrop-filter: blur(6px);
		-webkit-backdrop-filter: blur(6px);
	}
	.play svg {
		width: 15px;
		height: 15px;
		fill: #fff;
		margin-left: 2px;
	}
</style>
