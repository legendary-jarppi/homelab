<script lang="ts">
	import StoryList from '$lib/components/StoryList.svelte';
	import EndNote from '$lib/components/EndNote.svelte';
	import PageTitle from '$lib/components/PageTitle.svelte';
	import { useI18n } from '$lib/i18n';

	let { data } = $props();
	const i = useI18n();
</script>

<svelte:head>
	<title>{i.t('nav.latest')} · Shilly Shally News</title>
</svelte:head>

<PageTitle title={i.t('nav.latest')} lede={i.t('latest.lede')} />

{#if data.cards.length > 0}
	<StoryList cards={data.cards} days />
{/if}

{#if data.next}
	<nav class="pager" aria-label={i.t('list.pages')}>
		<a class="button" href="/latest?before={encodeURIComponent(data.next)}" rel="next">{i.t('list.earlier')}</a>
	</nav>
{:else if data.cards.length === 0 && !data.paged}
	<EndNote>{i.t('latest.empty')}</EndNote>
{:else}
	<EndNote>{i.t('latest.end')}</EndNote>
{/if}
