<script lang="ts">
	import StoryList from '$lib/components/StoryList.svelte';
	import EndNote from '$lib/components/EndNote.svelte';
	import PageTitle from '$lib/components/PageTitle.svelte';

	let { data } = $props();
</script>

<svelte:head>
	<title>Latest · Shilly Shally News</title>
</svelte:head>

<PageTitle title="Latest" lede="Everything as it arrives, newest first." />

{#if data.cards.length > 0}
	<StoryList cards={data.cards} days />
{/if}

{#if data.next}
	<nav class="pager" aria-label="Pages">
		<a class="button" href="/latest?before={encodeURIComponent(data.next)}" rel="next">Earlier</a>
	</nav>
{:else if data.cards.length === 0 && !data.paged}
	<EndNote>Nothing new has come in yet. The presses are quiet.</EndNote>
{:else}
	<EndNote>That is everything for now.</EndNote>
{/if}
