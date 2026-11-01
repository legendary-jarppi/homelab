<script lang="ts">
	import StoryList from '$lib/components/StoryList.svelte';
	import EndNote from '$lib/components/EndNote.svelte';
	import PageTitle from '$lib/components/PageTitle.svelte';
	import { useI18n } from '$lib/i18n';

	let { data } = $props();
	const i = useI18n();
</script>

<svelte:head>
	<title>{data.query ? `${data.query} · ` : ''}{i.t('searchPage.title')} · Shilly Shally News</title>
</svelte:head>

<PageTitle title={i.t('searchPage.title')} />

<form class="search" role="search" method="get" action="/search">
	<div class="field">
		<label for="search-q">{i.t('searchPage.label')}</label>
		<input id="search-q" name="q" type="search" value={data.query} enterkeyhint="search" autocomplete="off" />
	</div>
	<button class="button button-primary" type="submit">{i.t('searchPage.submit')}</button>
	<p class="hint">{i.t('searchPage.hint')}</p>
</form>

{#if data.query}
	{#if data.cards.length > 0}
		<h2 class="section-head results">{i.t('searchPage.best')}</h2>
		<StoryList cards={data.cards} summaries level={3} />
	{:else}
		<EndNote>{i.t('searchPage.none', { query: data.query })}</EndNote>
	{/if}
{/if}

<style>
	.search {
		display: flex;
		flex-wrap: wrap;
		align-items: end;
		gap: 0 var(--space-4);
		max-width: 40rem;
		margin-bottom: var(--space-6);
	}

	.search .field {
		flex: 1 1 18rem;
		margin-bottom: 0;
	}

	.hint {
		flex: 1 1 100%;
		margin-top: var(--space-2);
		font-family: var(--font-ui);
		font-size: var(--step--2);
		color: var(--ink-2);
	}

	.results {
		margin-top: var(--space-5);
	}
</style>
