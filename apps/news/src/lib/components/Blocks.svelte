<script lang="ts">
	import type { Block } from '$lib/core/blocks';
	import type { Photo as PhotoData } from '$lib/server/photos';
	import Photo from './Photo.svelte';

	interface Props {
		blocks: Block[];
		photos: Record<number, PhotoData>;
		lang?: string;
	}

	let { blocks, photos, lang }: Props = $props();

	// The drop cap goes on the first paragraph that opens the text.
	const firstParagraph = $derived(blocks.findIndex((b) => b.type === 'p'));
</script>

<div class="body" {lang}>
	{#each blocks as block, i (i)}
		{#if block.type === 'p'}
			<p class:dropcap={i === firstParagraph && block.text.length > 120}>{block.text}</p>
		{:else if block.type === 'h'}
			<h2 class="subhead">{block.text}</h2>
		{:else if block.type === 'quote'}
			<blockquote>
				<p>{block.text}</p>
				{#if block.cite}<footer class="byline">{block.cite}</footer>{/if}
			</blockquote>
		{:else if block.type === 'list'}
			<svelte:element this={block.ordered ? 'ol' : 'ul'}>
				{#each block.items as item, j (j)}
					<li>{item}</li>
				{/each}
			</svelte:element>
		{:else if block.type === 'figure' && photos[block.image]}
			<div class="figure">
				<Photo photo={photos[block.image]} />
			</div>
		{/if}
	{/each}
</div>

<style>
	.body {
		max-width: var(--measure);
		font-size: var(--step-0);
		line-height: 1.62;
		hyphens: auto;
		-webkit-hyphens: auto;
		hanging-punctuation: first;
	}

	.body > :global(* + *) {
		margin-top: 1em;
	}

	.dropcap::first-letter {
		float: left;
		margin: 0.06em 0.09em 0 0;
		font-family: var(--font-head);
		font-size: 3.55em;
		font-weight: 700;
		line-height: 0.82;
		color: var(--ink);
	}

	.subhead {
		margin-top: 1.6em !important;
		font-size: var(--step-1);
		line-height: 1.25;
	}

	blockquote {
		margin-left: 0;
		margin-right: 0;
		padding: var(--space-2) 0 var(--space-2) var(--space-5);
		border-left: 3px solid var(--accent);
		font-family: var(--font-head);
		font-size: var(--step-1);
		font-style: italic;
		line-height: 1.35;
	}

	blockquote footer {
		margin-top: var(--space-2);
		font-style: normal;
	}

	ul,
	ol {
		padding-left: 1.3em;
	}

	li + li {
		margin-top: 0.4em;
	}

	.figure {
		margin-top: 1.6em !important;
		margin-bottom: 1.6em;
	}

	@media print {
		.body {
			max-width: none;
			columns: 2;
			column-gap: 8mm;
		}
	}
</style>
