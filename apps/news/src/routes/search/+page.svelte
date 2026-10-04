<script lang="ts">
	import StoryList from '$lib/components/StoryList.svelte';
	import EndNote from '$lib/components/EndNote.svelte';
	import PageTitle from '$lib/components/PageTitle.svelte';

	let { data } = $props();
</script>

<svelte:head>
	<title>{data.query ? `${data.query} · ` : ''}Search · Shilly Shally News</title>
</svelte:head>

<PageTitle title="Search" />

<form class="search" role="search" method="get" action="/search">
	<div class="field">
		<label for="search-q">Words to look for</label>
		<input id="search-q" name="q" type="search" value={data.query} enterkeyhint="search" autocomplete="off" />
	</div>
	<button class="button button-primary" type="submit">Search</button>
	<p class="hint">Finnish and English both work, and word endings are matched too. Put quotes around an exact phrase.</p>
</form>

{#if data.query}
	{#if data.cards.length > 0}
		<h2 class="section-head results">Best matches</h2>
		<StoryList cards={data.cards} summaries level={3} />
	{:else}
		<EndNote>Nothing in the paper matches “{data.query}”. Try fewer or different words.</EndNote>
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
