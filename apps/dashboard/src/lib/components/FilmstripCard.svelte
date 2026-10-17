<script lang="ts">
	import Card from './Card.svelte';
	import { eventTime } from '$lib/dates';
	import { night } from '$lib/night.svelte';
	import type { TelescopeFrame } from '$lib/types';

	/** Recent frames' small previews, newest first (null: no data from the service); tap opens the viewer at that frame. */
	let { frames, onopen }: { frames: TelescopeFrame[] | null; onopen: (index: number) => void } = $props();
</script>

<Card title="Recent frames">
	{#if !frames}
		<p class="muted">No data.</p>
	{:else if frames.length === 0}
		<p class="muted">No frames yet.</p>
	{:else}
		<div class="strip">
			{#each frames as f, i (f.id)}
				<button onclick={() => onopen(i)} aria-label="{f.target}, frame {f.number ?? ''}">
					<img src="/telescope/frames/{f.id}-small.jpg" alt="" loading="lazy" />
					<span class="caption num">{eventTime(new Date(f.at * 1000).toISOString(), night.now)}</span>
				</button>
			{/each}
		</div>
	{/if}
</Card>

<style>
	p {
		margin: 0;
		font-size: 14px;
	}
	.strip {
		display: flex;
		gap: 8px;
		overflow-x: auto;
		padding-bottom: 2px;
		scrollbar-width: none;
	}
	.strip::-webkit-scrollbar {
		display: none;
	}
	button {
		position: relative;
		flex: none;
		width: 96px;
		aspect-ratio: 1;
		padding: 0;
		border: 1px solid var(--border);
		border-radius: 12px;
		overflow: hidden;
		background: #000;
		cursor: pointer;
	}
	img {
		display: block;
		width: 100%;
		height: 100%;
		object-fit: cover;
		pointer-events: none;
	}
	.caption {
		position: absolute;
		left: 0;
		right: 0;
		bottom: 0;
		padding: 10px 6px 4px;
		font-size: 11px;
		font-weight: 600;
		text-align: left;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		color: #fff;
		background: linear-gradient(transparent, rgba(0, 0, 0, 0.75));
	}
</style>
