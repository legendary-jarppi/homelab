<script lang="ts">
	import EndNote from '$lib/components/EndNote.svelte';
	import PageTitle from '$lib/components/PageTitle.svelte';
	import PaperPicker from '$lib/components/PaperPicker.svelte';
	import Story from '$lib/components/Story.svelte';
	import StoryList from '$lib/components/StoryList.svelte';
	import { useI18n } from '$lib/i18n';

	let { data } = $props();
	const i = useI18n();
	const lead = $derived(data.top[0]);
	const rest = $derived(data.top.slice(1));
</script>

<svelte:head>
	<title>{data.paper.name} · Shilly Shally News</title>
</svelte:head>

<PageTitle title={data.paper.name} kicker={data.paged ? `${i.t('nav.papers')} · ${i.t('list.earlier')}` : i.t('nav.papers')} />

<PaperPicker papers={data.papers} current={data.paper.slug} />

{#if data.paper.hidden}
	<EndNote>{i.t('papers.hidden', { paper: data.paper.name })} <a href="/settings#outlets">{i.t('papers.settings')}</a></EndNote>
{:else}
	{#if lead}
		<section class="top" aria-labelledby="paper-top">
			<h2 class="section-head" id="paper-top">{i.t('papers.topNow')}</h2>
			<div class="top-grid">
				<div class="lead">
					<Story card={lead} variant="lead" level={3} photo summary />
				</div>
				{#if rest.length > 0}
					<div class="rest">
						{#each rest as card, n (card.id)}
							<Story {card} photo={n < 2} summary />
						{/each}
					</div>
				{/if}
			</div>
		</section>
	{/if}

	{#if data.cards.length > 0}
		{#if !data.paged}<h2 class="section-head newest">{i.t('papers.newest')}</h2>{/if}
		<StoryList cards={data.cards} days summaries level={data.paged ? 2 : 3} />
	{/if}

	{#if data.next}
		<nav class="pager" aria-label={i.t('list.pages')}>
			<a class="button" href="/papers/{data.paper.slug}?before={encodeURIComponent(data.next)}" rel="next">{i.t('list.earlier')}</a>
		</nav>
	{:else if data.cards.length === 0 && !data.paged}
		<EndNote>{i.t('papers.nothingFrom', { paper: data.paper.name })}</EndNote>
	{:else}
		<EndNote>{i.t('papers.end', { paper: data.paper.name })}</EndNote>
	{/if}
{/if}

<style>
	.top-grid {
		display: grid;
		gap: var(--space-5) var(--gutter);
	}

	.rest {
		columns: 2 16rem;
		column-gap: var(--gutter);
		column-rule: var(--hairline);
	}

	.rest > :global(.story) {
		padding: var(--space-3) 0;
		border-top: var(--hairline);
	}

	.rest > :global(.story:first-child) {
		border-top: 0;
		padding-top: 0;
	}

	.newest {
		margin-top: var(--space-7);
	}
</style>
