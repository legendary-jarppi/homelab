<script lang="ts">
	import EndNote from '$lib/components/EndNote.svelte';
	import PageTitle from '$lib/components/PageTitle.svelte';
	import Story from '$lib/components/Story.svelte';
	import StoryList from '$lib/components/StoryList.svelte';
	import { useI18n } from '$lib/i18n';

	let { data } = $props();
	const i = useI18n();
	const KIND = { person: 'entity.kind.person', organisation: 'entity.kind.organisation', place: 'entity.kind.place', other: 'entity.kind.other' } as const;
	// The newest three as cards with photos, the rest as a dated list.
	const top = $derived(data.paged ? [] : data.cards.slice(0, 3));
	const rest = $derived(data.paged ? data.cards : data.cards.slice(3));
</script>

<svelte:head>
	<title>{data.entity.name} · Shilly Shally News</title>
</svelte:head>

<PageTitle title={data.entity.name} kicker={i.t(KIND[data.entity.kind])} lede={data.paged ? undefined : i.t('entity.lede')} />

{#if top.length > 0}
	<section class="top" aria-label={i.t('entity.newest')}>
		{#each top as card (card.id)}
			<Story {card} photo summary />
		{/each}
	</section>
{/if}

{#if rest.length > 0}
	<StoryList cards={rest} days summaries />
{/if}

{#if data.next}
	<nav class="pager" aria-label={i.t('list.pages')}>
		<a class="button" href="/entity/{data.entity.id}?before={encodeURIComponent(data.next)}" rel="next">{i.t('list.earlier')}</a>
	</nav>
{:else}
	<EndNote>{i.t('entity.end', { name: data.entity.name })}</EndNote>
{/if}

<style>
	.top {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(16rem, 1fr));
		gap: var(--space-5) var(--gutter);
		margin-bottom: var(--space-5);
	}
</style>
