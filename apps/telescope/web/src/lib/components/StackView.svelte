<script lang="ts">
	import type { Snippet } from 'svelte';

	/**
	 * The stack large, with the latest frame over it: Stack / Latest buttons and a slider between the two
	 * (A1: single frame vs stack). Tap the picture for full screen (Esc or ✕ closes).
	 */
	let { stack, frame, alt, caption }: { stack: string | null; frame: string | null; alt: string; caption?: Snippet } = $props();

	/** 0 = stack only, 1 = latest frame only. */
	let blend = $state(0);
	let full = $state(false);
	const shown = $derived(stack ? (frame ? blend : 0) : frame ? 1 : 0);

	$effect(() => {
		if (!full) return;
		const key = (e: KeyboardEvent) => e.key === 'Escape' && (full = false);
		addEventListener('keydown', key);
		return () => removeEventListener('keydown', key);
	});
</script>

{#snippet picture(big: boolean)}
	<button class="picture" class:big onclick={() => (full = !full)} aria-label={big ? 'Close full screen' : 'Full screen'}>
		{#if stack}<img src={stack} {alt} />{/if}
		{#if frame}<img class="over" src={frame} alt="Latest frame" style:opacity={shown} />{/if}
		{#if !stack && !frame}<span class="none muted">No stack yet</span>{/if}
	</button>
{/snippet}

{#snippet controls()}
	{#if stack && frame}
		<div class="controls">
			<button class:on={blend === 0} onclick={() => (blend = 0)}>Stack</button>
			<input type="range" min="0" max="1" step="0.01" bind:value={blend} aria-label="Stack versus latest frame" />
			<button class:on={blend === 1} onclick={() => (blend = 1)}>Latest</button>
		</div>
	{/if}
{/snippet}

<div class="view">
	{@render picture(false)}
	{@render controls()}
	{#if caption}<div class="caption">{@render caption()}</div>{/if}
</div>

{#if full}
	<div class="full" role="dialog" aria-modal="true" aria-label={alt}>
		{@render picture(true)}
		<div class="bar">
			{@render controls()}
			<button class="close" onclick={() => (full = false)} aria-label="Close">✕</button>
		</div>
	</div>
{/if}

<style>
	.view {
		display: flex;
		flex-direction: column;
		gap: 10px;
		min-width: 0;
	}
	.picture {
		position: relative;
		display: block;
		width: 100%;
		aspect-ratio: 1;
		padding: 0;
		border: 1px solid var(--border);
		border-radius: 16px;
		overflow: hidden;
		background: #000;
		cursor: zoom-in;
	}
	.picture img {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		object-fit: contain;
		display: block;
	}
	.none {
		position: absolute;
		inset: 0;
		display: grid;
		place-items: center;
		font-size: 14px;
	}
	.controls {
		display: flex;
		align-items: center;
		gap: 10px;
	}
	.controls input {
		flex: 1;
		min-width: 60px;
		height: 4px;
		appearance: none;
		-webkit-appearance: none;
		border-radius: 2px;
		background: var(--surface-strong);
	}
	.controls input::-webkit-slider-thumb {
		-webkit-appearance: none;
		width: 20px;
		height: 20px;
		border-radius: 50%;
		background: var(--accent);
		border: 0;
	}
	.controls input::-moz-range-thumb {
		width: 20px;
		height: 20px;
		border-radius: 50%;
		background: var(--accent);
		border: 0;
	}
	.controls button,
	.close {
		padding: 6px 12px;
		border-radius: 999px;
		border: 1px solid var(--border);
		background: var(--surface);
		color: var(--muted);
		font-size: 13px;
		font-weight: 600;
		cursor: pointer;
	}
	.controls button.on {
		background: var(--surface-strong);
		color: var(--text);
	}
	.caption {
		font-size: 13px;
	}
	.full {
		position: fixed;
		inset: 0;
		z-index: 50;
		background: #000;
		display: flex;
		flex-direction: column;
		padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left);
	}
	.picture.big {
		flex: 1;
		aspect-ratio: auto;
		border: 0;
		border-radius: 0;
		cursor: zoom-out;
	}
	.bar {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 10px 14px;
	}
	.bar .controls {
		flex: 1;
	}
	.close {
		margin-left: auto;
	}
</style>
