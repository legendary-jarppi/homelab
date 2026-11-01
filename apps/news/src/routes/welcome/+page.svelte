<script lang="ts">
	import { enhance } from '$app/forms';
	import DisplayFields from '$lib/components/account/DisplayFields.svelte';
	import { autosubmit, keepValues } from '$lib/components/account/forms';
	import LanguageFields from '$lib/components/account/LanguageFields.svelte';
	import PresetCards from '$lib/components/account/PresetCards.svelte';
	import SensitivityEditor from '$lib/components/account/SensitivityEditor.svelte';

	import { useI18n } from '$lib/i18n';

	let { data, form } = $props();

	const i = useI18n();

	const TITLES = ['welcome.step1', 'welcome.step2', 'welcome.step3', 'welcome.step4', 'welcome.step5'] as const;

	let interactive = $state(false);
	$effect(() => {
		interactive = true;
	});
</script>

<svelte:head>
	<title>{i.t('welcome.title')} · Shilly Shally News</title>
</svelte:head>

<article class="welcome">
	<header>
		<p class="kicker">{i.t('welcome.kicker', { step: data.step, steps: data.steps })}</p>
		<h1 class="hed hed-5">{i.t(TITLES[data.step - 1])}</h1>
	</header>

	{#if form?.message}
		<p class="message" role="alert">{form.message}</p>
	{/if}

	{#if data.step === 1}
		<p class="lede">{i.t('welcome.intro')}</p>
		<form method="POST" action="?/language" use:enhance={keepValues} use:autosubmit>
			<p class="note">{i.t('welcome.language')}</p>
			<LanguageFields language={data.language} />
			{#if !interactive}
				<button class="button">{i.t('language.save')}</button>
			{/if}
		</form>
		<nav class="steps-nav">
			<a class="button button-primary" href="?step=2">{i.t('welcome.begin')}</a>
		</nav>
	{:else if data.step === 2}
		<p class="lede">{i.t('welcome.preset')}</p>
		<form method="POST" action="?/preset" use:enhance>
			<PresetCards selected={data.preset} />
			<nav class="steps-nav">
				<a class="button" href="?step=1">{i.t('prefs.back')}</a>
				<button class="button button-primary">{i.t('prefs.continue')}</button>
			</nav>
		</form>
	{:else if data.step === 3}
		<p class="lede">{i.t('welcome.fineTune', { single: i.t('sensitivity.single') })}</p>
		<SensitivityEditor thresholds={data.thresholds} saved={form?.saved ?? null} />
		<nav class="steps-nav">
			<a class="button" href="?step=2">{i.t('prefs.back')}</a>
			<a class="button button-primary" href="?step=4">{i.t('prefs.continue')}</a>
		</nav>
	{:else if data.step === 4}
		<form method="POST" action="?/display" use:enhance={keepValues}>
			<DisplayFields images={data.images} calmHeadlines={data.calmHeadlines} />
			<nav class="steps-nav">
				<a class="button" href="?step=3">{i.t('prefs.back')}</a>
				<button class="button button-primary">{i.t('prefs.continue')}</button>
			</nav>
		</form>
	{:else}
		<p class="lede">{i.t('welcome.done')}</p>
		<form method="POST" action="?/finish" use:enhance>
			<nav class="steps-nav">
				<a class="button" href="?step=4">{i.t('prefs.back')}</a>
				<button class="button button-primary">{i.t('welcome.read')}</button>
			</nav>
		</form>
	{/if}
</article>

<style>
	.welcome {
		max-width: 52rem;
		margin: 0 auto;
		padding: var(--space-6) 0 var(--space-8);
	}

	header {
		margin-bottom: var(--space-5);
		padding-bottom: var(--space-3);
		border-bottom: var(--hairline);
	}

	h1 {
		margin: var(--space-2) 0 0;
	}

	.lede {
		max-width: var(--measure);
		margin: 0 0 var(--space-5);
		font-size: var(--step-1);
		line-height: 1.5;
	}

	.message {
		font-family: var(--font-ui);
		font-size: var(--step--1);
		color: var(--accent);
	}

	.steps-nav {
		display: flex;
		justify-content: space-between;
		gap: var(--space-3);
		margin-top: var(--space-6);
		padding-top: var(--space-4);
		border-top: var(--hairline);
	}

	.steps-nav :only-child {
		margin-left: auto;
	}
</style>
