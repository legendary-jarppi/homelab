<script lang="ts">
	import { portal } from '$lib/portal';

	/**
	 * A picture full screen (a final stack's preview): fitted, tap or the 1:1 button for the full-size
	 * preview scrolled around; Esc or ✕ closes.
	 */
	let { src, alt, caption, onclose }: { src: string; alt: string; caption?: string; onclose: () => void } = $props();

	let actual = $state(false);

	$effect(() => {
		const key = (e: KeyboardEvent) => e.key === 'Escape' && onclose();
		addEventListener('keydown', key);
		return () => removeEventListener('keydown', key);
	});
</script>

<div class="full" use:portal role="dialog" aria-modal="true" aria-label={alt}>
	<button class="picture" class:actual onclick={() => (actual = !actual)} aria-label={actual ? 'Fit to screen' : 'Full size'}>
		<img {src} {alt} />
	</button>
	<div class="bar">
		{#if caption}<span class="caption">{caption}</span>{/if}
		<button class="btn" class:on={actual} onclick={() => (actual = !actual)}>1:1</button>
		<button class="btn" onclick={onclose} aria-label="Close">✕</button>
	</div>
</div>

<style>
	.full {
		position: fixed;
		inset: 0;
		z-index: 50;
		background: #000;
		display: flex;
		flex-direction: column;
		padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left);
	}
	.picture {
		flex: 1;
		min-height: 0;
		padding: 0;
		border: 0;
		background: #000;
		cursor: zoom-in;
		overflow: hidden;
		display: grid;
		place-items: center;
	}
	.picture img {
		max-width: 100%;
		max-height: 100%;
		object-fit: contain;
		display: block;
	}
	.picture.actual {
		overflow: auto;
		display: block;
		cursor: zoom-out;
	}
	.picture.actual img {
		max-width: none;
		max-height: none;
	}
	.bar {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 10px 14px;
	}
	.caption {
		flex: 1;
		min-width: 0;
		font-size: 13px;
		color: var(--muted);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.bar .btn:first-of-type {
		margin-left: auto;
	}
</style>
