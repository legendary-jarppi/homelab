<script lang="ts">
	import EndNote from '$lib/components/EndNote.svelte';
	import PageTitle from '$lib/components/PageTitle.svelte';
	import PaperPicker from '$lib/components/PaperPicker.svelte';
	import StoryList from '$lib/components/StoryList.svelte';

	let { data } = $props();
</script>

<svelte:head>
	<title>{data.paper.name} · Shilly Shally News</title>
</svelte:head>

<PageTitle title={data.paper.name} kicker={data.paged ? 'Papers · Earlier' : 'Papers'} />

<PaperPicker papers={data.papers} current={data.paper.slug} />

{#if data.paper.hidden}
	<EndNote>You have hidden {data.paper.name} in your <a href="/settings#outlets">settings</a>; its stories are not shown anywhere.</EndNote>
{:else}
	{#if data.cards.length > 0}
		<StoryList cards={data.cards} days summaries />
	{/if}

	{#if data.next}
		<nav class="pager" aria-label="Pages">
			<a class="button" href="/papers/{data.paper.slug}?before={encodeURIComponent(data.next)}" rel="next">Earlier</a>
		</nav>
	{:else if data.cards.length === 0 && !data.paged}
		<EndNote>Nothing from {data.paper.name} just now.</EndNote>
	{:else}
		<EndNote>That is everything from {data.paper.name}.</EndNote>
	{/if}
{/if}
