<script lang="ts">
	import StoryList from '$lib/components/StoryList.svelte';
	import EndNote from '$lib/components/EndNote.svelte';
	import PageTitle from '$lib/components/PageTitle.svelte';
	import { useI18n } from '$lib/i18n';

	let { data } = $props();
	const i = useI18n();
</script>

<svelte:head>
	<title>{i.t('savedPage.title')} · Shilly Shally News</title>
</svelte:head>

<PageTitle title={i.t('savedPage.title')} lede={i.t('savedPage.lede')} />

{#if data.cards.length > 0}
	<StoryList cards={data.cards} summaries />
{/if}

{#if data.next}
	<nav class="pager" aria-label={i.t('savedPage.pages')}>
		<a class="button" href="/saved?before={encodeURIComponent(data.next)}" rel="next">{i.t('savedPage.more')}</a>
	</nav>
{:else if data.cards.length === 0 && !data.paged}
	<EndNote>{i.t('savedPage.empty')}</EndNote>
{/if}
