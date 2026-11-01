<script lang="ts">
	import { page } from '$app/state';
	import { useI18n } from '$lib/i18n';

	const i = useI18n();
</script>

<svelte:head>
	<title>{page.status === 404 ? i.t('errorPage.notFoundTitle') : i.t('errorPage.title')} · Shilly Shally News</title>
</svelte:head>

<section class="error">
	{#if page.status === 404}
		<h1 class="hed hed-4">{i.t('errorPage.notFound')}</h1>
		<p>{i.t('errorPage.notFoundHint')}</p>
	{:else}
		<h1 class="hed hed-4">{i.t('errorPage.failed')}</h1>
		<p>{i.t('errorPage.failedHint')}</p>
	{/if}
	<p><a class="button" href="/">{i.t('errorPage.home')}</a></p>
</section>

<style>
	.error {
		display: grid;
		gap: var(--space-4);
		justify-items: start;
		max-width: 36rem;
		margin: var(--space-8) auto;
	}

	.error p:not(:has(.button)) {
		color: var(--ink-2);
		font-style: italic;
	}
</style>
