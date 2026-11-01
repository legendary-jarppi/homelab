<script lang="ts">
	import Story from '$lib/components/Story.svelte';
	import StoryList from '$lib/components/StoryList.svelte';
	import EndNote from '$lib/components/EndNote.svelte';
	import PageTitle from '$lib/components/PageTitle.svelte';
	import { useI18n } from '$lib/i18n';

	let { data } = $props();
	const i = useI18n();
	const label = $derived(i.section(data.key));
	const lead = $derived(data.stories[0]);
	const rest = $derived(data.stories.slice(1));
</script>

<svelte:head>
	<title>{label} · Shilly Shally News</title>
</svelte:head>

<PageTitle title={label} kicker={data.paged ? i.t('list.earlier') : i.t('section.kicker')} />

{#if lead}
	<section class="front" aria-label={i.t('section.now', { section: label })}>
		<div class="lead">
			<Story card={lead} variant="lead" level={2} photo summary />
		</div>
		{#if rest.length > 0}
			<div class="rest">
				{#each rest as card, n (card.id)}
					<Story {card} photo={n < 3} summary={n < 6} />
				{/each}
			</div>
		{/if}
	</section>
{/if}

{#if data.earlier.cards.length > 0}
	{#if !data.paged}<h2 class="section-head earlier">{i.t('list.earlier')}</h2>{/if}
	<StoryList cards={data.earlier.cards} days level={data.paged ? 2 : 3} />
{/if}

{#if data.earlier.next}
	<nav class="pager" aria-label={i.t('list.pages')}>
		<a class="button" href="/section/{data.key}?before={encodeURIComponent(data.earlier.next)}" rel="next">{i.t('list.earlier')}</a>
	</nav>
{:else if !lead && data.earlier.cards.length === 0}
	<EndNote>{i.t('section.empty', { section: label })}</EndNote>
{:else}
	<EndNote>{i.t('section.end', { section: label })}</EndNote>
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
