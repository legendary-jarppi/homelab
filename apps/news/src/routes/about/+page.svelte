<script lang="ts">
	import PageTitle from '$lib/components/PageTitle.svelte';
	import { useI18n } from '$lib/i18n';

	const i = useI18n();
</script>

<svelte:head>
	<title>{i.t('aboutPage.title')} · Shilly Shally News</title>
</svelte:head>

<PageTitle title={i.t('aboutPage.title')} />

<div class="about">
	<p>{i.t('aboutPage.intro')}</p>

	<h2 class="section-head">{i.t('aboutPage.frontHead')}</h2>
	<p>{i.t('aboutPage.front')}</p>
	<p>{i.t('aboutPage.latestLead')} <em>{i.t('aboutPage.latest')}</em> {i.t('aboutPage.latestTail')}</p>

	<h2 class="section-head">{i.t('aboutPage.papersHead')}</h2>
	<p>
		{i.t('aboutPage.papersLead')} <em>{i.t('aboutPage.papers')}</em>{i.t('aboutPage.papersTail')}
		{i.t('aboutPage.articleLead')} (<em>{i.t('aboutPage.alsoIn')}</em>){i.t('aboutPage.articleTail')}
	</p>

	<h2 class="section-head">{i.t('aboutPage.filterHead')}</h2>
	<p>{i.t('aboutPage.filter')}</p>
	<p>{i.t('aboutPage.calm')}</p>

	<h2 class="section-head">{i.t('aboutPage.privacyHead')}</h2>
	<p>{i.t('aboutPage.privacy')}</p>
	<p>{i.t('aboutPage.room')}</p>
</div>

<style>
	.about {
		display: grid;
		gap: var(--space-4);
		max-width: var(--measure);
	}

	.about h2 {
		margin: var(--space-4) 0 0;
	}

	.about p {
		margin: 0;
	}
</style>
