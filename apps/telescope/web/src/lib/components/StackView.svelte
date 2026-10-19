<script lang="ts">
	import type { Snippet } from 'svelte';
	import ImageViewer from './ImageViewer.svelte';

	/**
	 * The stack large, with the latest frame over it: Stack / Latest buttons and a slider between the two
	 * (A1: single frame vs stack). Tap the picture for the full-resolution viewer: the stack (with its
	 * histogram, star measurement and annotation) or, when the slider is past the middle, the latest frame.
	 */
	let { sessionId, stack, frame, alt, caption }: { sessionId: string; stack: string | null; frame: string | null; alt: string; caption?: Snippet } = $props();

	/** 0 = stack only, 1 = latest frame only. */
	let blend = $state(0);
	let full = $state(false);
	const shown = $derived(stack ? (frame ? blend : 0) : frame ? 1 : 0);
	const stackShown = $derived(stack !== null && shown < 0.5);
</script>

<div class="view">
	<button class="picture" onclick={() => (full = true)} disabled={!stack && !frame} aria-label="Full screen">
		{#if stack}<img src={stack} {alt} />{/if}
		{#if frame}<img class="over" src={frame} alt="Latest frame" style:opacity={shown} />{/if}
		{#if !stack && !frame}<span class="none muted">No stack yet</span>{/if}
	</button>
	{#if stack && frame}
		<div class="controls">
			<button class:on={blend === 0} onclick={() => (blend = 0)}>Stack</button>
			<input type="range" min="0" max="1" step="0.01" bind:value={blend} aria-label="Stack versus latest frame" />
			<button class:on={blend === 1} onclick={() => (blend = 1)}>Latest</button>
		</div>
	{/if}
	{#if caption}<div class="caption">{@render caption()}</div>{/if}
</div>

{#if full && (stack || frame)}
	{#if stackShown}
		<ImageViewer image={{ kind: 'stack', id: sessionId }} src={stack!} {alt} caption={alt} onclose={() => (full = false)} />
	{:else}
		<ImageViewer src={frame!} alt="Latest frame" caption="Latest frame" onclose={() => (full = false)} />
	{/if}
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
	.controls button {
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
</style>
