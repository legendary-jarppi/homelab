<script lang="ts">
	import Story from '$lib/components/Story.svelte';
	import EndNote from '$lib/components/EndNote.svelte';
	import { useI18n } from '$lib/i18n';

	let { data } = $props();
	const i = useI18n();
	const front = $derived(data.front);
</script>

<svelte:head>
	<title>Shilly Shally News</title>
</svelte:head>

<h1 class="visually-hidden">{i.t('front.title')}</h1>

{#if front.lead}
	<section class="top" aria-label={i.t('front.topStories')}>
		<div class="lead-col">
			<Story card={front.lead} variant="lead" level={2} photo summary />
		</div>
		{#if front.secondary.length > 0}
			<div class="secondary-col">
				{#each front.secondary as card (card.id)}
					<Story {card} variant="secondary" photo summary />
				{/each}
			</div>
		{/if}
		{#if front.latest.length > 0}
			<aside class="latest-col" aria-labelledby="latest">
				<h2 class="section-head" id="latest"><a href="/latest">{i.t('front.latest')}</a></h2>
				{#each front.latest as card (card.id)}
					<Story {card} variant="brief" ago />
				{/each}
				<p class="more"><a href="/latest">{i.t('front.allLatest')}</a></p>
			</aside>
		{/if}
	</section>

	{#if front.sections.length > 0}
		<hr class="rule-double" />
		<div class="sections">
			{#each front.sections as block (block.key)}
				<section class="block" aria-labelledby="sec-{block.key}">
					<h2 class="section-head" id="sec-{block.key}"><a href="/section/{block.key}">{i.section(block.key)}</a></h2>
					<div class="block-top">
						<Story card={block.stories[0]} variant="top" photo summary />
					</div>
					{#if block.stories.length > 1}
						<div class="block-rest">
							{#each block.stories.slice(1) as card (card.id)}
								<Story {card} />
							{/each}
						</div>
					{/if}
				</section>
			{/each}
		</div>
	{/if}

	{#if front.papers.length > 0}
		<hr class="rule-double" />
		<section class="papers" aria-labelledby="by-paper">
			<h2 class="section-head" id="by-paper"><a href="/papers">{i.t('front.byPaper')}</a></h2>
			<div class="paper-grid">
				{#each front.papers as paper (paper.slug)}
					<section class="paper" aria-labelledby="paper-{paper.slug}">
						<h3 class="paper-name" id="paper-{paper.slug}"><a href="/papers/{paper.slug}">{paper.name}</a></h3>
						<ul>
							{#each paper.stories as card (card.id)}
								<li class:is-read={card.read}>
									<a class="hed hed-1" href="/article/{card.id}" lang={card.language ?? undefined}>{card.headline}</a>
									<time class="byline" datetime={card.publishedAt.toISOString()} title={i.fullDate(card.publishedAt)}>{i.when(card.publishedAt)}</time>
								</li>
							{/each}
						</ul>
						<p class="more"><a href="/papers/{paper.slug}">{i.t('front.allFromPaper', { paper: paper.name })}</a></p>
					</section>
				{/each}
			</div>
		</section>
	{/if}

	<EndNote>
		{i.t('front.endNote')}
		<a href="/latest">{i.t('front.endNoteLatest')}</a>
	</EndNote>
{:else}
	<EndNote>
		{i.t('front.empty')}
	</EndNote>
{/if}

<style>
	.top {
		display: grid;
		gap: var(--space-6) var(--gutter);
		margin-top: var(--space-5);
	}

	.secondary-col,
	.latest-col {
		display: grid;
		align-content: start;
		gap: var(--space-5);
	}

	.secondary-col > :global(* + *),
	.latest-col > :global(.story + .story) {
		padding-top: var(--space-4);
		border-top: var(--hairline);
	}

	.latest-col {
		gap: var(--space-3);
	}

	.latest-col > :global(.story + .story) {
		padding-top: var(--space-3);
	}

	.latest-col .section-head {
		margin-bottom: 0;
	}

	.more {
		font-family: var(--font-ui);
		font-size: var(--step--1);
		font-weight: 600;
	}

	.more a {
		text-decoration-color: var(--accent);
	}

	.sections {
		display: grid;
		gap: var(--space-7) var(--gutter);
	}

	.block {
		display: grid;
		align-content: start;
		gap: var(--space-4);
	}

	.block .section-head {
		margin-bottom: 0;
	}

	.block-rest {
		columns: 2 14rem;
		column-gap: var(--gutter);
		column-rule: var(--hairline);
	}

	.block-rest > :global(.story) {
		padding: var(--space-3) 0;
		border-top: var(--hairline);
	}

	/* By paper: each paper's nameplate over its top headlines, like a newsstand. */
	.paper-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(15rem, 1fr));
		gap: var(--space-6) var(--gutter);
	}

	.paper {
		display: grid;
		align-content: start;
		gap: var(--space-3);
	}

	.paper-name {
		padding-bottom: var(--space-2);
		border-bottom: 3px double var(--ink);
		font-family: var(--font-head);
		font-size: var(--step-2);
		font-weight: 700;
		line-height: 1.1;
	}

	.paper-name a {
		text-decoration: none;
	}

	.paper-name a:hover {
		text-decoration: underline;
		text-decoration-color: var(--accent);
	}

	.paper ul {
		display: grid;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.paper li {
		display: grid;
		gap: var(--space-1);
		padding: var(--space-3) 0;
		border-top: var(--hairline);
	}

	.paper li:first-child {
		border-top: 0;
		padding-top: 0;
	}

	.paper li .hed {
		text-decoration: none;
	}

	.paper li .hed:hover {
		text-decoration: underline;
	}

	.paper li.is-read .hed {
		color: var(--ink-2);
	}

	/* Column rules are drawn in the gap, so they never change the column widths. */
	.secondary-col > :global(*),
	.secondary-col,
	.latest-col,
	.block {
		position: relative;
	}

	/* iPad portrait and up: secondaries side by side, Latest in columns. */
	@media (min-width: 48rem) {
		.secondary-col {
			grid-template-columns: repeat(3, minmax(0, 1fr));
			column-gap: var(--gutter);
		}

		.secondary-col > :global(* + *) {
			padding-top: 0;
			border-top: 0;
		}

		.secondary-col > :global(* + *)::before,
		.block:nth-child(even)::before {
			content: '';
			position: absolute;
			top: 0;
			bottom: 0;
			left: calc(var(--gutter) / -2);
			border-left: var(--hairline);
		}

		.latest-col {
			display: block;
			columns: 2 16rem;
			column-gap: var(--gutter);
			column-rule: var(--hairline);
		}

		.latest-col .section-head,
		.latest-col .more {
			column-span: all;
			margin-bottom: var(--space-3);
		}

		.latest-col .more {
			margin: var(--space-3) 0 0;
		}

		.latest-col > :global(.story) {
			padding: var(--space-2) 0 var(--space-3);
		}

		.latest-col > :global(.story + .story) {
			padding-top: var(--space-2);
			border-top: 0;
		}

		.sections {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}

	/* Broadsheet: lead | secondaries | latest, with column rules. */
	@media (min-width: 75rem) {
		.top {
			grid-template-columns: minmax(0, 6fr) minmax(0, 3fr) minmax(0, 3fr);
		}

		.secondary-col {
			grid-template-columns: minmax(0, 1fr);
		}

		/* One photo in the rail keeps it about as tall as the lead. */
		.secondary-col > :global(.story + .story .art) {
			display: none;
		}

		.secondary-col > :global(* + *) {
			padding: var(--space-4) 0 0;
			border-top: var(--hairline);
		}

		.secondary-col > :global(* + *)::before {
			content: none;
		}

		.secondary-col::before,
		.latest-col::before {
			content: '';
			position: absolute;
			top: 0;
			bottom: 0;
			left: calc(var(--gutter) / -2);
			border-left: var(--hairline);
		}

		.latest-col {
			display: grid;
			columns: auto;
		}

		.latest-col .section-head {
			margin-bottom: 0;
		}

		.latest-col > :global(.story + .story) {
			padding-top: var(--space-3);
			border-top: var(--hairline);
		}
	}

	@media print {
		.sections {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}
</style>
