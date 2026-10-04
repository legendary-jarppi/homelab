<script lang="ts">
	import type { Card } from '$lib/server/articles';
	import Photo from './Photo.svelte';
	import { fullDate, when } from './format';

	type Variant = 'lead' | 'secondary' | 'top' | 'standard' | 'brief';

	interface Props {
		card: Card;
		variant?: Variant;
		level?: 2 | 3;
		photo?: boolean;
		summary?: boolean;
	}

	let { card, variant = 'standard', level = 3, photo = false, summary = false }: Props = $props();

	// Headline size per slot: [ordinary, important (importance >= 4)].
	const SIZES: Record<Variant, [number, number]> = {
		lead: [6, 6],
		secondary: [3, 4],
		top: [2, 3],
		standard: [2, 3],
		brief: [1, 1]
	};
	const size = $derived(SIZES[variant][card.importance >= 4 ? 1 : 0]);
</script>

<article class="story {variant}" class:is-read={card.read} class:has-photo={photo && card.photo}>
	<div class="inner">
		{#if photo && card.photo}
			<div class="art">
				<Photo photo={card.photo} ratio={variant === 'lead' ? undefined : '3 / 2'} caption={variant === 'lead'} eager={variant === 'lead'} />
			</div>
		{/if}
		<div class="text">
			{#if card.kicker && variant !== 'brief'}<p class="kicker">{card.kicker}</p>{/if}
			<svelte:element this={`h${level}`} class="hed hed-{size}" lang={card.language ?? undefined}>
				<a href="/article/{card.id}">{card.headline}</a>
			</svelte:element>
			{#if summary && card.summary}<p class="summary" lang={card.language ?? undefined}>{card.summary}</p>{/if}
			<p class="byline">
				{card.outlet}
				<span aria-hidden="true">·</span>
				<time datetime={card.publishedAt.toISOString()} title={fullDate(card.publishedAt)}>{when(card.publishedAt)}</time>
				{#if variant !== 'brief'}
					<span aria-hidden="true">·</span>
					{card.minutes} min read
				{/if}
			</p>
			{#if card.alsoIn.length > 0}
				<p class="also">Also in {card.alsoIn.join(', ')}</p>
			{/if}
		</div>
	</div>
</article>

<style>
	.story {
		container-type: inline-size;
		break-inside: avoid;
	}

	.text {
		display: grid;
		gap: var(--space-2);
		align-content: start;
	}

	.art {
		margin-bottom: var(--space-3);
	}

	.summary {
		font-size: var(--step-0);
	}

	.standard .summary,
	.top .summary {
		font-size: var(--step--1);
	}

	.lead .summary {
		font-size: var(--step-1);
		line-height: 1.45;
		color: var(--ink);
	}

	.also {
		font-family: var(--font-ui);
		font-size: var(--step--2);
		color: var(--ink-3);
		font-style: normal;
	}

	.is-read .summary {
		color: var(--ink-3);
	}

	/* Wide lead: photo beside the text, like a broadsheet's top story. */
	@container (min-width: 46rem) {
		.lead.has-photo .inner {
			display: grid;
			grid-template-columns: minmax(0, 4fr) minmax(0, 3fr);
			gap: var(--gutter);
		}

		.lead.has-photo .art {
			margin: 0;
			grid-column: 1;
			grid-row: 1;
		}

		/* The text column is narrow here; one step down keeps the headline to a few lines. */
		.lead.has-photo .hed {
			font-size: var(--step-4);
		}
	}

	/* Section tops: photo beside the headline once there is room for both. */
	@container (min-width: 26rem) {
		.top.has-photo .inner {
			display: grid;
			grid-template-columns: repeat(2, minmax(0, 1fr));
			gap: var(--space-4);
		}

		.top.has-photo .art {
			margin: 0;
		}
	}

	/* Phones: secondary and section-top photos become thumbnails beside the text, so the stack stays short. */
	@media (max-width: 47.99rem) {
		.secondary.has-photo .inner,
		.top.has-photo .inner {
			display: grid;
			grid-template-columns: minmax(0, 1fr) 32%;
			gap: var(--space-4);
		}

		.secondary.has-photo .art,
		.top.has-photo .art {
			grid-column: 2;
			grid-row: 1;
			margin: 0.35em 0 0;
		}

		.secondary.has-photo .text,
		.top.has-photo .text {
			grid-column: 1;
			grid-row: 1;
		}

		.secondary .hed {
			font-size: var(--step-2);
		}
	}
</style>
