<script lang="ts">
	import { fade, scale } from 'svelte/transition';
	import FrameFacts from './FrameFacts.svelte';
	import type { TelescopeData, TelescopeFrame } from '$lib/types';

	/** Recent frames newest first, as the filmstrip; `index` 0 is the latest. Arrow keys and swipes step. */
	let {
		frames,
		plan,
		index = $bindable(),
		onclose
	}: { frames: TelescopeFrame[]; plan: TelescopeData['plan']; index: number; onclose: () => void } = $props();

	const current = $derived(frames[Math.min(index, frames.length - 1)]);
	let strip: HTMLDivElement;
	/** Where a touch on the picture started, for swipes. */
	let swipeFrom: { x: number; y: number } | null = null;

	const go = (i: number) => (index = Math.min(Math.max(i, 0), frames.length - 1));

	$effect(() => {
		strip?.querySelector('.active')?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
	});

	function onkeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') onclose();
		else if (event.key === 'ArrowRight') go(index + 1);
		else if (event.key === 'ArrowLeft') go(index - 1);
	}

	/** A mostly horizontal drag of 50 px or more: left = older, right = newer (like turning pages). */
	function onpointerup(event: PointerEvent) {
		if (!swipeFrom) return;
		const dx = event.clientX - swipeFrom.x;
		const dy = event.clientY - swipeFrom.y;
		swipeFrom = null;
		if (Math.abs(dx) >= 50 && Math.abs(dx) > 1.5 * Math.abs(dy)) go(dx < 0 ? index + 1 : index - 1);
	}
</script>

<svelte:window {onkeydown} />

<div class="backdrop" transition:fade={{ duration: 180 }} onclick={(e) => e.target === e.currentTarget && onclose()} role="presentation">
	<div class="viewer" transition:scale={{ start: 0.96, duration: 220 }} role="dialog" aria-modal="true" aria-label="Telescope frames" tabindex="-1">
		<div
			class="picture"
			role="presentation"
			onpointerdown={(e) => (swipeFrom = { x: e.clientX, y: e.clientY })}
			{onpointerup}
			onpointercancel={() => (swipeFrom = null)}
		>
			{#key current.id}
				<img src="/telescope/frames/{current.id}.jpg" alt="{current.target}, frame {current.number ?? ''}" draggable="false" />
			{/key}
		</div>
		<div class="side">
			<div class="bar">
				<span class="count muted num">{index + 1} / {frames.length}</span>
				<div class="actions">
					<button onclick={() => go(index - 1)} disabled={index === 0} aria-label="Newer">
						<svg viewBox="0 0 24 24"><path d="m15 5-7 7 7 7" /></svg>
					</button>
					<button onclick={() => go(index + 1)} disabled={index === frames.length - 1} aria-label="Older">
						<svg viewBox="0 0 24 24"><path d="m9 5 7 7-7 7" /></svg>
					</button>
					<button onclick={onclose} aria-label="Close">
						<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18" /></svg>
					</button>
				</div>
			</div>
			<div class="details"><FrameFacts frame={current} {plan} full /></div>
		</div>
		<div class="strip" bind:this={strip}>
			{#each frames as f, i (f.id)}
				<button class:active={i === index} onclick={() => go(i)} aria-label="Frame {i + 1}">
					<img src="/telescope/frames/{f.id}-small.jpg" alt="" loading="lazy" />
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
		background: rgba(3, 5, 10, 0.86);
		backdrop-filter: blur(18px);
		-webkit-backdrop-filter: blur(18px);
	}
	/* Wide screens: the square picture as tall as fits, details beside it, the strip below both. */
	.viewer {
		--pic: min(calc(100dvh - 32px - 96px), calc(100vw - 32px - 332px), 1504px);
		display: grid;
		grid-template-columns: var(--pic) 300px;
		grid-template-areas: 'pic side' 'strip strip';
		gap: 12px 20px;
		outline: none;
	}
	.picture {
		grid-area: pic;
		width: var(--pic);
		aspect-ratio: 1;
		border-radius: 20px;
		overflow: hidden;
		background: #000;
		box-shadow: 0 40px 100px rgba(0, 0, 0, 0.6);
		touch-action: pan-y pinch-zoom;
	}
	.picture img {
		display: block;
		width: 100%;
		height: 100%;
		object-fit: contain;
		user-select: none;
		-webkit-user-select: none;
	}
	.side {
		grid-area: side;
		display: flex;
		flex-direction: column;
		gap: 18px;
		min-width: 0;
	}
	.bar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
	}
	.count {
		font-size: 14px;
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
		grid-area: strip;
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
		width: 72px;
		aspect-ratio: 1;
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
		pointer-events: none;
	}
	/* Portrait screens and phones: controls, picture, details, then the strip; the page scrolls. */
	@media (max-aspect-ratio: 5/4) {
		.backdrop {
			place-items: start center;
			overflow-y: auto;
		}
		.viewer {
			--pic: min(calc(100vw - 32px), 1504px);
			grid-template-columns: var(--pic);
			grid-template-areas: 'bar' 'pic' 'details' 'strip';
		}
		.side {
			display: contents;
		}
		.bar {
			grid-area: bar;
		}
		.details {
			grid-area: details;
		}
	}
</style>
