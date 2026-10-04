<script lang="ts">
	import StoryList from '$lib/components/StoryList.svelte';
	import EndNote from '$lib/components/EndNote.svelte';
	import PageTitle from '$lib/components/PageTitle.svelte';

	let { data } = $props();
</script>

<svelte:head>
	<title>Saved · Shilly Shally News</title>
</svelte:head>

<PageTitle title="Saved" lede="Articles you kept for later." />

{#if data.cards.length > 0}
	<StoryList cards={data.cards} summaries />
{/if}

{#if data.next}
	<nav class="pager" aria-label="Pages">
		<a class="button" href="/saved?before={encodeURIComponent(data.next)}" rel="next">More saved articles</a>
	</nav>
{:else if data.cards.length === 0 && !data.paged}
	<EndNote>Nothing saved yet. Tap “Save” on any article to keep it here.</EndNote>
{/if}
