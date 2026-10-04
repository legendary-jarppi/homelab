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
	import { page } from '$app/state';

	let { data, children } = $props();
</script>

<a class="skip-link" href="#main">Skip to the news</a>

{#if data.user?.onboarded}
	<Masthead edition={data.edition} user={data.user} query={page.url.pathname === '/search' ? (page.url.searchParams.get('q') ?? '') : ''} />
	<SectionBar path={page.url.pathname} />
{:else}
	<Masthead minimal />
{/if}
<main id="main" class="page">
	{@render children()}
</main>

<footer class="page colophon">
	<hr class="rule-double" />
	<p>
		Shilly Shally News is a private reading room for family and friends. Articles belong to their outlets; each one links
		to its original.
		<a href="/about">About this paper</a>
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
