<script lang="ts">
	import Story from '$lib/components/Story.svelte';
	import EndNote from '$lib/components/EndNote.svelte';
	import { clock } from '$lib/components/format';

	let { data } = $props();
	const front = $derived(data.front);
</script>

<svelte:head>
	<title>Shilly Shally News · {data.edition.label}</title>
</svelte:head>

<h1 class="visually-hidden">Front page, {data.edition.label}</h1>

{#if front.lead}
	<section class="top" aria-label="Top stories">
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
		{#if front.brief.length > 0}
			<aside class="brief-col" aria-labelledby="in-brief">
				<h2 class="section-head" id="in-brief">In brief</h2>
				{#each front.brief as card (card.id)}
					<Story {card} variant="brief" />
				{/each}
			</aside>
		{/if}
	</section>

	{#if front.sections.length > 0}
		<hr class="rule-double" />
		<div class="sections">
			{#each front.sections as block (block.key)}
				<section class="block" aria-labelledby="sec-{block.key}">
					<h2 class="section-head" id="sec-{block.key}"><a href="/section/{block.key}">{block.label}</a></h2>
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

	<EndNote>
		That is the {data.edition.label}. The {data.edition.nextLabel} is out at {clock(data.edition.nextAt)}.
	</EndNote>
{:else}
	<EndNote>
		The {data.edition.label} is still being set. The {data.edition.nextLabel} is out at {clock(data.edition.nextAt)}; meanwhile,
		<a href="/latest">Latest</a> has everything since.
	</EndNote>
{/if}

<style>
	.top {
		display: grid;
		gap: var(--space-6) var(--gutter);
		margin-top: var(--space-5);
	}

	.secondary-col,
	.brief-col {
		display: grid;
		align-content: start;
		gap: var(--space-5);
	}

	.secondary-col > :global(* + *),
	.brief-col > :global(.story + .story) {
		padding-top: var(--space-4);
		border-top: var(--hairline);
	}

	.brief-col {
		gap: var(--space-3);
	}

	.brief-col > :global(.story + .story) {
		padding-top: var(--space-3);
	}

	.brief-col .section-head {
		margin-bottom: 0;
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

	/* Column rules are drawn in the gap, so they never change the column widths. */
	.secondary-col > :global(*),
	.secondary-col,
	.brief-col,
	.block {
		position: relative;
	}

	/* iPad portrait and up: secondaries side by side, in brief in columns. */
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

		.brief-col {
			display: block;
			columns: 2 16rem;
			column-gap: var(--gutter);
			column-rule: var(--hairline);
		}

		.brief-col .section-head {
			column-span: all;
			margin-bottom: var(--space-3);
		}

		.brief-col > :global(.story) {
			padding: var(--space-2) 0 var(--space-3);
		}

		.brief-col > :global(.story + .story) {
			padding-top: var(--space-2);
			border-top: 0;
		}

		.sections {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}

	/* Broadsheet: lead | secondaries | in brief, with column rules. */
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
		.brief-col::before {
			content: '';
			position: absolute;
			top: 0;
			bottom: 0;
			left: calc(var(--gutter) / -2);
			border-left: var(--hairline);
		}

		.brief-col {
			display: grid;
			columns: auto;
		}

		.brief-col .section-head {
			margin-bottom: 0;
		}

		.brief-col > :global(.story + .story) {
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
