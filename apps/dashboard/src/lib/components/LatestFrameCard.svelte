<script lang="ts">
	import Card from './Card.svelte';
	import FrameFacts from './FrameFacts.svelte';
	import type { TelescopeData } from '$lib/types';

	/** The newest frame, large; tap opens the viewer at it. `configured`: TELESCOPE_URL is set. */
	let { telescope, configured, onopen }: { telescope: TelescopeData | null; configured: boolean; onopen: (index: number) => void } = $props();

	const frame = $derived(telescope?.frames[0] ?? null);
</script>

<Card title="Latest frame">
	{#if !configured}
		<p class="muted">Telescope not set up.</p>
	{:else if !telescope}
		<p class="muted">Telescope unavailable.</p>
	{:else if !frame}
		<p class="muted">No frames yet.</p>
	{:else}
		<button class="picture" onclick={() => onopen(0)} aria-label="Open {frame.target}, frame {frame.number ?? ''}">
			{#key frame.id}
				<img src="/telescope/frames/{frame.id}.jpg" alt="" />
			{/key}
		</button>
		<FrameFacts {frame} plan={telescope.plan} />
	{/if}
</Card>

<style>
	p {
		margin: 0;
		font-size: 14px;
	}
	.picture {
		flex: 1;
		min-height: 0;
		width: 100%;
		aspect-ratio: 1;
		padding: 0;
		border: 1px solid var(--border);
		border-radius: 16px;
		overflow: hidden;
		background: #000;
		cursor: pointer;
	}
	.picture img {
		display: block;
		width: 100%;
		height: 100%;
		object-fit: contain;
		pointer-events: none;
	}
	/* One-screen layout: the picture takes whatever height the card has left (still square inside). */
	@container telescope-frame (min-height: 1px) {
		.picture {
			aspect-ratio: auto;
		}
	}
</style>
