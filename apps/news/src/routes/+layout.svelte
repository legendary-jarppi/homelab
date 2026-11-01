<script lang="ts">
	import '@fontsource/unifrakturmaguntia/latin-400.css';
	import '@fontsource-variable/playfair-display/wght.css';
	import '@fontsource-variable/playfair-display/wght-italic.css';
	import '@fontsource-variable/source-serif-4/opsz.css';
	import '@fontsource-variable/source-serif-4/opsz-italic.css';
	import '@fontsource-variable/libre-franklin/wght.css';
	import '../app.css';
	import Masthead from '$lib/components/Masthead.svelte';
	import SectionBar from '$lib/components/SectionBar.svelte';
	import { invalidateAll } from '$app/navigation';
	import { page } from '$app/state';
	import { setI18n, useI18n } from '$lib/i18n';

	let { data, children } = $props();
	setI18n(() => data.locale);
	const i = useI18n();

	// <html lang> is set on the server; keep it right after a language change in Settings.
	$effect(() => {
		document.documentElement.lang = data.locale;
	});

	/** Reading pages refresh when the reader comes back to them after a while (the paper is live). */
	const REFRESH_AFTER_MS = 5 * 60_000;
	const live = (path: string) => path === '/' || path === '/latest' || path.startsWith('/section/') || path.startsWith('/papers');
	let loadedAt = Date.now();
	$effect(() => {
		void data;
		loadedAt = Date.now();
	});
	$effect(() => {
		const onVisible = () => {
			if (document.visibilityState === 'visible' && live(page.url.pathname) && Date.now() - loadedAt > REFRESH_AFTER_MS) void invalidateAll();
		};
		document.addEventListener('visibilitychange', onVisible);
		return () => document.removeEventListener('visibilitychange', onVisible);
	});
</script>

<a class="skip-link" href="#main">{i.t('skip.toNews')}</a>

{#if data.user?.onboarded}
	<Masthead updatedAt={data.updatedAt} user={data.user} query={page.url.pathname === '/search' ? (page.url.searchParams.get('q') ?? '') : ''} />
	<SectionBar path={page.url.pathname} papers={data.papers} />
{:else}
	<Masthead minimal />
{/if}
<main id="main" class="page">
	{@render children()}
</main>

<footer class="page colophon">
	<hr class="rule-double" />
	<p>
		{i.t('footer.text')}
		<a href="/about">{i.t('footer.about')}</a>
	</p>
</footer>

<style>
	.colophon {
		padding-bottom: var(--space-7);
	}

	.colophon p {
		font-family: var(--font-ui);
		font-size: var(--step--2);
		color: var(--ink-3);
		max-width: var(--measure);
	}

	.colophon hr {
		margin-top: var(--space-7);
	}
</style>
