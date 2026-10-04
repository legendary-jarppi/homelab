<script lang="ts">
	import type { Card } from '$lib/server/articles';
	import { clock, dateline, fullDate, when } from './format';

	interface Props {
		cards: Card[];
		/** Group under day headings (Latest, Earlier). */
		days?: boolean;
		summaries?: boolean;
		/** Level of the outermost heading this list emits (day headings when grouped, else headlines). */
		level?: 2 | 3;
	}

	let { cards, days = false, summaries = false, level = 2 }: Props = $props();
	const headlineLevel = $derived(days ? level + 1 : level);

	const groups = $derived.by(() => {
		const out: { day: string; cards: Card[] }[] = [];
		for (const card of cards) {
			const day = days ? dateline(card.publishedAt) : '';
			const last = out.at(-1);
			if (last && last.day === day) last.cards.push(card);
			else out.push({ day, cards: [card] });
		}
		return out;
	});
</script>

{#each groups as group (group.day)}
	{#if days}<svelte:element this={`h${level}`} class="day">{group.day}</svelte:element>{/if}
	<ol class="list" class:dated={!days}>
		{#each group.cards as card (card.id)}
			<li class:is-read={card.read}>
				<time class="time" datetime={card.publishedAt.toISOString()} title={fullDate(card.publishedAt)}>{days ? clock(card.publishedAt) : when(card.publishedAt)}</time>
				<div class="text">
					{#if card.kicker}<p class="kicker">{card.kicker}</p>{/if}
					<svelte:element this={`h${headlineLevel}`} class="hed hed-2" lang={card.language ?? undefined}><a href="/article/{card.id}">{card.headline}</a></svelte:element>
					{#if summaries && card.summary}<p class="summary" lang={card.language ?? undefined}>{card.summary}</p>{/if}
					<p class="byline">{card.outlet} <span aria-hidden="true">·</span> {card.minutes} min read</p>
				</div>
			</li>
		{/each}
	</ol>
{/each}

<style>
	.day {
		margin: var(--space-6) 0 0;
		padding-bottom: var(--space-2);
		border-bottom: var(--hairline);
		font-family: var(--font-ui);
		font-size: var(--step--1);
		font-weight: 600;
		font-variant-caps: all-small-caps;
		letter-spacing: 0.12em;
		color: var(--ink-2);
	}

	.list {
		margin: 0;
		padding: 0;
		list-style: none;
	}

	li {
		display: grid;
		grid-template-columns: 4.2em 1fr;
		gap: var(--space-4);
		padding: var(--space-4) 0;
		border-top: var(--hairline);
	}

	.dated li {
		grid-template-columns: 7.5em 1fr;
	}

	li:first-child {
		border-top: 0;
	}

	.time {
		padding-top: 0.15em;
		font-family: var(--font-ui);
		font-size: var(--step--1);
		font-variant-numeric: tabular-nums lining-nums;
		color: var(--ink-2);
	}

	.text {
		display: grid;
		gap: var(--space-1);
		max-width: var(--measure);
	}

	.summary {
		margin-top: var(--space-1);
	}

	@media (max-width: 30rem) {
		li,
		.dated li {
			grid-template-columns: 1fr;
			gap: var(--space-1);
		}
	}
</style>
