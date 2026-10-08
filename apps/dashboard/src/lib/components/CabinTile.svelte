<script lang="ts">
	import MotionViewer from './MotionViewer.svelte';
	import { cabinEvents } from '$lib/cabin';
	import { eventTime } from '$lib/dates';
	import { night } from '$lib/night.svelte';
	import type { CabinData } from '$lib/types';

	/**
	 * The cabin among the live cameras: it has no stream (4G camera uploading over FTPS), so this shows
	 * its latest motion picture, styled like CameraTile; tap for its pictures and clips.
	 */
	let { cabin }: { cabin: CabinData | null } = $props();

	const events = $derived(cabin ? cabinEvents(cabin.snapshots) : []);
	const latest = $derived(events[0] ?? null);
	let open = $state<number | null>(null);
</script>

<button class="tile" onclick={() => latest && (open = 0)} disabled={!latest} aria-label="Cabin: motion pictures and clips">
	{#if latest?.image}
		<img src={latest.image} alt="Latest motion at the cabin" />
	{:else if latest?.video}
		<video src="{latest.video}#t=0.1" muted playsinline preload="metadata"></video>
	{:else}
		<div class="placeholder"></div>
	{/if}
	<div class="shade"></div>
	<span class="label">Cabin</span>
	<span class="badge">
		{#if !cabin}Unavailable{:else if latest}Motion · {eventTime(new Date(latest.time).toISOString(), night.now)}{:else}No motion yet{/if}
	</span>
	{#if latest}<span class="hint">Tap for pictures and clips</span>{/if}
</button>

{#if open !== null && events.length > 0}
	<MotionViewer items={events} bind:index={open} label="Cabin camera pictures and clips" onclose={() => (open = null)} />
{/if}

<style>
	.tile {
		position: relative;
		display: block;
		width: 100%;
		aspect-ratio: 16 / 9;
		padding: 0;
		border: 1px solid var(--border);
		border-radius: 18px;
		overflow: hidden;
		background: #0b0f19;
		cursor: pointer;
		transition: transform 0.2s ease, border-color 0.2s;
	}
	.tile:disabled {
		cursor: default;
	}
	.tile:active:not(:disabled) {
		transform: scale(0.985);
	}
	img,
	video,
	.placeholder {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		object-fit: cover;
		pointer-events: none;
	}
	.placeholder {
		background: #0b0f19;
	}
	.shade {
		position: absolute;
		inset: 0;
		background: linear-gradient(to top, rgba(0, 0, 0, 0.65), transparent 45%);
	}
	.label {
		position: absolute;
		left: 14px;
		bottom: 11px;
		font-size: 16px;
		font-weight: 600;
		text-shadow: 0 1px 6px rgba(0, 0, 0, 0.6);
	}
	.badge {
		position: absolute;
		top: 10px;
		left: 10px;
		padding: 4px 9px;
		font-size: 11px;
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		border-radius: 999px;
		color: var(--warn);
		background: rgba(0, 0, 0, 0.45);
		backdrop-filter: blur(8px);
		-webkit-backdrop-filter: blur(8px);
	}
	.hint {
		position: absolute;
		right: 12px;
		bottom: 12px;
		font-size: 12px;
		color: rgba(255, 255, 255, 0.7);
		opacity: 0;
		transition: opacity 0.2s;
	}
	@media (hover: hover) {
		.tile:hover:not(:disabled) {
			border-color: rgba(255, 255, 255, 0.2);
		}
		.tile:hover .hint {
			opacity: 1;
		}
	}
</style>
