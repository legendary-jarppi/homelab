<script lang="ts">
	import type { Photo } from '$lib/server/photos';

	interface Props {
		photo: Photo;
		/** Crop to this aspect ratio (e.g. '3 / 2'); default: the photo's own. */
		ratio?: string;
		caption?: boolean;
		eager?: boolean;
	}

	let { photo, ratio, caption = true, eager = false }: Props = $props();

	// Gated photos stay a neutral placeholder; their bytes are fetched only after the tap.
	// Keyed by id so a reused component never carries a reveal over to another photo.
	let revealedId: number | null = $state(null);
	const revealed = $derived(revealedId === photo.id);
	const shown = $derived(!photo.gated || revealed);
	let frame: HTMLElement | undefined = $state();

	function reveal() {
		revealedId = photo.id;
		// Keep keyboard focus on the photo instead of losing it with the removed button.
		queueMicrotask(() => frame?.focus());
	}
</script>

<!-- Tall photos are capped so they fit the screen; crops fill their box. -->
<figure class="photo" style:max-width={ratio ? undefined : `calc(80vh * ${photo.width} / ${photo.height})`}>
	<!-- svelte-ignore a11y_no_noninteractive_tabindex (-1 only: a focus target after "Show photo") -->
	<div class="photo-frame frame" style:aspect-ratio={ratio ?? `${photo.width} / ${photo.height}`} bind:this={frame} tabindex={revealed ? -1 : undefined}>
		{#if shown}
			<img
				src="/img/{photo.id}"
				width={photo.width}
				height={photo.height}
				alt={photo.alt ?? ''}
				loading={eager ? 'eager' : 'lazy'}
				decoding="async"
			/>
		{:else}
			<button type="button" class="reveal" onclick={reveal}>Show photo</button>
		{/if}
	</div>
	{#if caption && shown && (photo.caption || photo.credit)}
		<figcaption class="caption">
			{#if photo.caption}{photo.caption}{/if}
			{#if photo.credit}<span class="credit">{photo.credit}</span>{/if}
		</figcaption>
	{/if}
</figure>

<style>
	.photo {
		margin: 0 auto;
	}

	.frame {
		position: relative;
		overflow: hidden;
		width: 100%;
	}

	.frame:focus-visible {
		outline-offset: 2px;
	}

	.reveal {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 100%;
		min-height: var(--touch);
		border: 0;
		background:
			repeating-linear-gradient(135deg, transparent 0 6px, color-mix(in srgb, var(--rule) 45%, transparent) 6px 7px),
			var(--paper-2);
		color: var(--ink-2);
		font-family: var(--font-ui);
		font-size: var(--step--1);
		font-weight: 600;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		cursor: pointer;
	}

	.reveal:hover {
		color: var(--ink);
	}

	.reveal:focus-visible {
		outline-offset: -4px;
	}

	@media print {
		.reveal {
			display: none;
		}
	}
</style>
