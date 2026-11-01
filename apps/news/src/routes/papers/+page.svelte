<script lang="ts">
	import PageTitle from '$lib/components/PageTitle.svelte';
	import { useI18n } from '$lib/i18n';

	let { data } = $props();
	const i = useI18n();
</script>

<svelte:head>
	<title>{i.t('nav.papers')} · Shilly Shally News</title>
</svelte:head>

<PageTitle title={i.t('nav.papers')} lede={i.t('papers.lede')} />

<ul class="papers">
	{#each data.papers as p (p.slug)}
		<li>
			<h2 class="name"><a href="/papers/{p.slug}">{p.name}</a></h2>
			{#if p.hidden}
				<p class="note">{i.t('papers.hiddenShort')} <a href="/settings#outlets">{i.t('papers.settings')}</a></p>
			{:else if p.stories.length > 0}
				<ol>
					{#each p.stories as card (card.id)}
						<li class:is-read={card.read}>
							<a class="hed hed-1" href="/article/{card.id}" lang={card.language ?? undefined}>{card.headline}</a>
							<time class="byline" datetime={card.publishedAt.toISOString()} title={i.fullDate(card.publishedAt)}>{i.when(card.publishedAt)}</time>
						</li>
					{/each}
				</ol>
				<p class="more"><a href="/papers/{p.slug}">{i.t('front.allFromPaper', { paper: p.name })}</a></p>
			{:else}
				<p class="note">{i.t('papers.nothingNow')}</p>
			{/if}
		</li>
	{/each}
</ul>

<style>
	.papers {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(17rem, 1fr));
		gap: var(--space-6) var(--gutter);
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.papers > li {
		display: grid;
		gap: var(--space-3);
		align-content: start;
	}

	.name {
		padding-bottom: var(--space-2);
		border-bottom: 3px double var(--ink);
		font-family: var(--font-head);
		font-size: var(--step-3);
		font-weight: 700;
		line-height: 1.1;
	}

	.name a {
		text-decoration: none;
	}

	.name a:hover {
		text-decoration: underline;
		text-decoration-color: var(--accent);
	}

	ol {
		margin: 0;
		padding: 0;
		list-style: none;
	}

	ol li {
		display: grid;
		gap: var(--space-1);
		padding: var(--space-3) 0;
		border-top: var(--hairline);
	}

	ol li:first-child {
		border-top: 0;
		padding-top: 0;
	}

	ol .hed {
		text-decoration: none;
	}

	ol .hed:hover {
		text-decoration: underline;
	}

	ol li.is-read .hed {
		color: var(--ink-2);
	}

	.more {
		font-family: var(--font-ui);
		font-size: var(--step--1);
		font-weight: 600;
	}

	.more a {
		text-decoration-color: var(--accent);
	}

	.note {
		font-family: var(--font-ui);
		font-size: var(--step--1);
		color: var(--ink-2);
	}
</style>
