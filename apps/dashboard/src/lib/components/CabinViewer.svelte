<script lang="ts">
	import { fade, scale } from 'svelte/transition';
	import { snapshotUrl } from '$lib/cabin';
	import { eventTime } from '$lib/dates';
	import { night } from '$lib/night.svelte';
	import type { CabinData } from '$lib/types';

	/** Newest first, as the strip below the picture; `index` 0 is the latest. */
	let {
		snapshots,
		index = $bindable(),
		onclose
	}: { snapshots: CabinData['snapshots']; index: number; onclose: () => void } = $props();

	const current = $derived(snapshots[Math.min(index, snapshots.length - 1)]);
	let strip: HTMLDivElement;

	const step = (delta: number) => (index = Math.min(Math.max(index + delta, 0), snapshots.length - 1));

	$effect(() => {
		strip?.querySelector('.active')?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
	});

	function onkeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') onclose();
		else if (event.key === 'ArrowRight') step(1);
		else if (event.key === 'ArrowLeft') step(-1);
	}
</script>

<svelte:window {onkeydown} />

<div class="backdrop" transition:fade={{ duration: 180 }} onclick={(e) => e.target === e.currentTarget && onclose()} role="presentation">
	<div class="viewer" transition:scale={{ start: 0.96, duration: 220 }} role="dialog" aria-modal="true" aria-label="Cabin camera pictures" tabindex="-1">
		<div class="picture">
			<img src={snapshotUrl(current.path)} alt="Motion at the cabin" />
		</div>
		<div class="bar">
			<span class="badge">Motion</span>
			<span class="title">Cabin · {eventTime(new Date(current.time).toISOString(), night.now)}</span>
			<span class="count muted num">{index + 1} / {snapshots.length}</span>
			<div class="actions">
				<button onclick={() => step(-1)} disabled={index === 0} aria-label="Newer picture">
					<svg viewBox="0 0 24 24"><path d="m15 5-7 7 7 7" /></svg>
				</button>
				<button onclick={() => step(1)} disabled={index === snapshots.length - 1} aria-label="Older picture">
					<svg viewBox="0 0 24 24"><path d="m9 5 7 7-7 7" /></svg>
				</button>
				<button onclick={onclose} aria-label="Close">
					<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18" /></svg>
				</button>
			</div>
		</div>
		<div class="strip" bind:this={strip}>
			{#each snapshots as s, i (s.path)}
				<button class:active={i === index} onclick={() => (index = i)} aria-label="Picture {i + 1}">
					<img src={snapshotUrl(s.path)} alt="" loading="lazy" />
				</button>
			{/each}
		</div>
	</div>
</div>

<style>
	.backdrop {
		position: fixed;
		inset: 0;
		z-index: 50;
		display: grid;
		place-items: center;
		padding: max(16px, env(safe-area-inset-top)) max(16px, env(safe-area-inset-right)) max(16px, env(safe-area-inset-bottom))
			max(16px, env(safe-area-inset-left));
		background: rgba(3, 5, 10, 0.78);
		backdrop-filter: blur(18px);
		-webkit-backdrop-filter: blur(18px);
	}
	.viewer {
		width: min(100%, calc((100dvh - 210px) * 16 / 9), 1600px);
		display: grid;
		gap: 12px;
		outline: none;
	}
	.picture {
		aspect-ratio: 16 / 9;
		border-radius: 20px;
		overflow: hidden;
		background: #000;
		box-shadow: 0 40px 100px rgba(0, 0, 0, 0.6);
	}
	.picture img {
		display: block;
		width: 100%;
		height: 100%;
		object-fit: contain;
	}
	.bar {
		display: flex;
		align-items: center;
		gap: 12px;
	}
	.title {
		flex: 1;
		font-size: 20px;
		font-weight: 600;
	}
	.count {
		font-size: 14px;
	}
	.badge {
		padding: 4px 10px;
		font-size: 12px;
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		border-radius: 999px;
		background: rgba(251, 191, 36, 0.15);
		color: var(--warn);
	}
	.actions {
		display: flex;
		gap: 8px;
	}
	.actions button {
		width: 44px;
		height: 44px;
		display: grid;
		place-items: center;
		border: 1px solid var(--border);
		border-radius: 50%;
		background: var(--surface-strong);
		cursor: pointer;
	}
	.actions button:disabled {
		opacity: 0.35;
		cursor: default;
	}
	.actions svg {
		width: 20px;
		height: 20px;
		fill: none;
		stroke: currentColor;
		stroke-width: 2;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
	.strip {
		display: flex;
		gap: 8px;
		overflow-x: auto;
		padding-bottom: 4px;
		scrollbar-width: none;
	}
	.strip::-webkit-scrollbar {
		display: none;
	}
	.strip button {
		flex: none;
		width: 112px;
		aspect-ratio: 16 / 9;
		padding: 0;
		border: 2px solid transparent;
		border-radius: 10px;
		overflow: hidden;
		background: #000;
		opacity: 0.6;
		cursor: pointer;
	}
	.strip button.active {
		border-color: var(--warn);
		opacity: 1;
	}
	.strip img {
		display: block;
		width: 100%;
		height: 100%;
		object-fit: cover;
	}
	@media (max-width: 640px) {
		.title {
			font-size: 16px;
		}
		.count {
			display: none;
		}
	}
</style>
