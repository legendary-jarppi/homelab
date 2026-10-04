<script lang="ts">
	import Story from '$lib/components/Story.svelte';
	import StoryList from '$lib/components/StoryList.svelte';
	import EndNote from '$lib/components/EndNote.svelte';
	import PageTitle from '$lib/components/PageTitle.svelte';

	let { data } = $props();
	const lead = $derived(data.stories[0]);
	const rest = $derived(data.stories.slice(1));
</script>

<svelte:head>
	<title>{data.label} · Shilly Shally News</title>
</svelte:head>

<PageTitle title={data.label} kicker={data.paged ? 'Earlier' : data.edition.label} />

{#if lead}
	<section class="front" aria-label="In this edition">
		<div class="lead">
			<Story card={lead} variant="lead" level={2} photo summary />
		</div>
		{#if rest.length > 0}
			<div class="rest">
				{#each rest as card, i (card.id)}
					<Story {card} photo={i < 3} summary={i < 6} />
				{/each}
			</div>
		{/if}
	</section>
{/if}

{#if data.earlier.cards.length > 0}
	{#if !data.paged}<h2 class="section-head earlier">Earlier</h2>{/if}
	<StoryList cards={data.earlier.cards} days level={data.paged ? 2 : 3} />
{/if}

{#if data.earlier.next}
	<nav class="pager" aria-label="Pages">
		<a class="button" href="/section/{data.key}?before={encodeURIComponent(data.earlier.next)}" rel="next">Earlier</a>
	</nav>
{:else if !lead && data.earlier.cards.length === 0}
	<EndNote>Nothing in {data.label} just now. The {data.edition.nextLabel} may bring more.</EndNote>
{:else}
	<EndNote>That is everything in {data.label}.</EndNote>
{/if}

<style>
	.front {
		display: grid;
		gap: var(--space-6);
	}

	.rest {
		columns: 3 16rem;
		column-gap: var(--gutter);
		column-rule: var(--hairline);
	}

	.rest > :global(.story) {
		padding: var(--space-4) 0;
		border-top: var(--hairline);
	}

	.rest > :global(.story:first-child) {
		border-top: 0;
		padding-top: 0;
	}

	.earlier {
		margin-top: var(--space-7);
	}
</style>
