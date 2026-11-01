<script lang="ts">
	import { enhance } from '$app/forms';
	import BlockedWords from '$lib/components/account/BlockedWords.svelte';
	import DisplayFields from '$lib/components/account/DisplayFields.svelte';
	import { autosubmit, keepValues } from '$lib/components/account/forms';
	import PresetCards from '$lib/components/account/PresetCards.svelte';
	import SensitivityEditor from '$lib/components/account/SensitivityEditor.svelte';
	import LanguageFields from '$lib/components/account/LanguageFields.svelte';
	import TopicsForm from '$lib/components/account/TopicsForm.svelte';
	import { PRESETS } from '$lib/core/taxonomy';
	import { useI18n } from '$lib/i18n';

	let { data, form } = $props();

	const i = useI18n();

	let interactive = $state(false);
	$effect(() => {
		interactive = true;
	});

	const SECTIONS = ['comfort', 'sensitivity', 'topics', 'outlets', 'words', 'display', 'language', 'theme', 'account'] as const;
	const THEMES = ['system', 'light', 'dark'] as const;

	const confirmPreset = $derived(form?.confirmPreset ? PRESETS.find((p) => p.key === form.confirmPreset) : null);
	const lastPreset = $derived(PRESETS.some((p) => p.key === data.settings.preset) ? i.preset(data.settings.preset!).label : i.t('settings.comfort.none'));
	const savedText = (section: string) => (form?.saved === section ? i.t('prefs.saved') : '');
	const errorFor = (section: string) => (form?.section === section ? form.message : null);
</script>

<svelte:head>
	<title>{i.t('settings.title')} · Shilly Shally News</title>
</svelte:head>

<div class="settings">
	<header>
		<p class="kicker">{i.t('settings.kicker')}</p>
		<h1 class="hed hed-5">{i.t('settings.title')}</h1>
		<p class="note">{i.t('settings.note')}</p>
		<nav aria-label={i.t('settings.toc')}>
			<ul class="toc">
				{#each SECTIONS as id (id)}
					<li><a href="#{id}">{i.t(`settings.${id}`)}</a></li>
				{/each}
			</ul>
		</nav>
	</header>

	<section id="comfort" aria-labelledby="comfort-head">
		<h2 class="section-head" id="comfort-head">{i.t('settings.comfort')}</h2>
		<p class="intro">{i.t('settings.comfort.intro', { preset: lastPreset })}</p>
		{#if confirmPreset}
			<form class="confirm" method="POST" action="?/preset" use:enhance>
				<input type="hidden" name="preset" value={confirmPreset.key} />
				<input type="hidden" name="confirm" value="yes" />
				<p>
					<strong>{i.t('settings.comfort.confirm', { preset: i.preset(confirmPreset.key).label })}</strong>
					{i.t('settings.comfort.confirmText')}
				</p>
				<div class="actions">
					<button class="button button-primary">{i.t('settings.comfort.replace')}</button>
					<a class="button" href="/settings#comfort">{i.t('settings.comfort.keep')}</a>
				</div>
			</form>
		{:else}
			<form method="POST" action="?/preset" use:enhance>
				<PresetCards selected={data.settings.preset} />
				<button class="button">{i.t('settings.comfort.use')}</button>
			</form>
		{/if}
		{#if errorFor('comfort')}<p class="error" role="alert">{errorFor('comfort')}</p>{/if}
		<p class="status" aria-live="polite">{form?.saved === 'comfort' ? i.t('settings.comfort.applied') : ''}</p>
	</section>

	<section id="sensitivity" aria-labelledby="sensitivity-head">
		<h2 class="section-head" id="sensitivity-head">{i.t('settings.sensitivity')}</h2>
		<p class="intro">{i.t('settings.sensitivity.intro')}</p>
		<SensitivityEditor thresholds={data.thresholds} saved={form?.saved ?? null} />
	</section>

	<section id="topics" aria-labelledby="topics-head">
		<h2 class="section-head" id="topics-head">{i.t('settings.topics')}</h2>
		<p class="intro">{i.t('settings.topics.intro')}</p>
		<TopicsForm hidden={data.hiddenTopics} />
		<p class="status" aria-live="polite">{savedText('topics')}</p>
	</section>

	<section id="outlets" aria-labelledby="outlets-head">
		<h2 class="section-head" id="outlets-head">{i.t('settings.outlets')}</h2>
		<p class="intro">{i.t('settings.outlets.intro')}</p>
		<form method="POST" action="?/outlets" use:enhance={keepValues} use:autosubmit>
			<ul class="checks">
				{#each data.outlets as outlet (outlet.id)}
					<li>
						<label>
							<input type="checkbox" name="outlet" value={outlet.id} checked={!outlet.hidden} />
							<span>{outlet.name}</span>
						</label>
					</li>
				{/each}
			</ul>
			{#if !interactive}
				<button class="button">{i.t('settings.outlets.save')}</button>
			{/if}
		</form>
		<p class="status" aria-live="polite">{savedText('outlets')}</p>
	</section>

	<section id="words" aria-labelledby="words-head">
		<h2 class="section-head" id="words-head">{i.t('settings.words')}</h2>
		<BlockedWords terms={data.terms} maxLength={data.maxTermLength} />
		{#if errorFor('words')}<p class="error" role="alert">{errorFor('words')}</p>{/if}
		<p class="status" aria-live="polite">{savedText('words')}</p>
	</section>

	<section id="display" aria-labelledby="display-head">
		<h2 class="section-head" id="display-head">{i.t('settings.display')}</h2>
		<form method="POST" action="?/display" use:enhance={keepValues} use:autosubmit>
			<DisplayFields images={data.settings.images} calmHeadlines={data.settings.calmHeadlines} />
			{#if !interactive}
				<button class="button">{i.t('prefs.save')}</button>
			{/if}
		</form>
		{#if errorFor('display')}<p class="error" role="alert">{errorFor('display')}</p>{/if}
		<p class="status" aria-live="polite">{savedText('display')}</p>
	</section>

	<section id="language" aria-labelledby="language-head">
		<h2 class="section-head" id="language-head">{i.t('settings.language')}</h2>
		<p class="intro">{i.t('settings.language.intro')}</p>
		<form method="POST" action="?/language" use:enhance={keepValues} use:autosubmit>
			<LanguageFields language={data.settings.language} />
			{#if !interactive}
				<button class="button">{i.t('language.save')}</button>
			{/if}
		</form>
		{#if errorFor('language')}<p class="error" role="alert">{errorFor('language')}</p>{/if}
		<p class="status" aria-live="polite">{savedText('language')}</p>
	</section>

	<section id="theme" aria-labelledby="theme-head">
		<h2 class="section-head" id="theme-head">{i.t('settings.theme')}</h2>
		<form
			method="POST"
			action="?/theme"
			use:enhance={keepValues}
			use:autosubmit
			onchange={(e) => {
				const value = (e.target as HTMLInputElement).value;
				document.documentElement.classList.remove('system', 'light', 'dark');
				document.documentElement.classList.add(value);
			}}
		>
			<fieldset class="checks">
				<legend class="visually-hidden">{i.t('settings.theme')}</legend>
				{#each THEMES as theme (theme)}
					<label>
						<input type="radio" name="theme" value={theme} checked={data.settings.theme === theme} />
						<span>{i.t(`settings.theme.${theme}`)}</span>
					</label>
				{/each}
			</fieldset>
			{#if !interactive}
				<button class="button">{i.t('settings.theme.save')}</button>
			{/if}
		</form>
	</section>

	<section id="account" aria-labelledby="account-head">
		<h2 class="section-head" id="account-head">{i.t('settings.account')}</h2>
		<p class="intro">{i.t('settings.account.signedInAs')} <strong>{data.username}</strong>.</p>

		<form class="narrow" method="POST" action="?/name" use:enhance={keepValues}>
			<div class="field">
				<label for="display-name">{i.t('settings.account.name')}</label>
				<input id="display-name" name="displayName" value={data.displayName} required maxlength="60" autocomplete="name" />
			</div>
			<button class="button">{i.t('settings.account.saveName')}</button>
			{#if errorFor('account')}<p class="error" role="alert">{errorFor('account')}</p>{/if}
			<p class="status" aria-live="polite">{savedText('name')}</p>
		</form>

		<form class="narrow" method="POST" action="?/password" use:enhance>
			<h3>{i.t('settings.password.head')}</h3>
			<div class="field">
				<label for="current-password">{i.t('settings.password.current')}</label>
				<input id="current-password" name="current" type="password" required autocomplete="current-password" />
			</div>
			<div class="field">
				<label for="new-password">{i.t('settings.password.new')}</label>
				<input id="new-password" name="next" type="password" required minlength={data.minPasswordLength} autocomplete="new-password" />
				<span class="hint">{i.t('settings.password.hint', { n: data.minPasswordLength })}</span>
			</div>
			<div class="field">
				<label for="confirm-password">{i.t('settings.password.again')}</label>
				<input id="confirm-password" name="confirm" type="password" required minlength={data.minPasswordLength} autocomplete="new-password" />
			</div>
			<button class="button">{i.t('settings.password.head')}</button>
			{#if errorFor('password')}<p class="error" role="alert">{errorFor('password')}</p>{/if}
			<p class="status" aria-live="polite">{form?.saved === 'password' ? i.t('settings.password.changed') : ''}</p>
		</form>

		<form class="narrow" method="POST" action="?/signOutAll">
			<h3>{i.t('settings.signOutAll.head')}</h3>
			<p class="intro">{i.t('settings.signOutAll.intro')}</p>
			<button class="button">{i.t('settings.signOutAll.head')}</button>
		</form>
	</section>
</div>

<style>
	.settings {
		max-width: 60rem;
		margin: 0 auto;
		padding: var(--space-5) 0 var(--space-8);
	}

	header {
		margin-bottom: var(--space-6);
	}

	h1 {
		margin: var(--space-1) 0 var(--space-2);
	}

	.toc {
		display: flex;
		flex-wrap: wrap;
		gap: 0 var(--space-4);
		margin: var(--space-4) 0 0;
		padding: var(--space-2) 0;
		border-top: var(--hairline);
		border-bottom: var(--hairline);
		list-style: none;
		font-family: var(--font-ui);
		font-size: var(--step--1);
	}

	.toc a {
		display: inline-flex;
		align-items: center;
		min-height: var(--touch);
		text-decoration: none;
	}

	.toc a:hover {
		text-decoration: underline;
	}

	section {
		margin-bottom: var(--space-7);
		scroll-margin-top: var(--space-6);
	}

	h3 {
		margin: var(--space-5) 0 var(--space-3);
		font-family: var(--font-head);
		font-size: var(--step-1);
	}

	.intro {
		max-width: var(--measure);
		color: var(--ink-2);
	}

	.confirm {
		padding: var(--space-4);
		border: 1px solid var(--ink);
		max-width: 40rem;
	}

	.confirm p {
		margin: 0 0 var(--space-4);
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-3);
	}

	.checks {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(14rem, 1fr));
		gap: 0 var(--space-5);
		margin: 0 0 var(--space-3);
		padding: 0;
		border: 0;
		list-style: none;
	}

	.checks label {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		min-height: var(--touch);
		cursor: pointer;
	}

	.checks input {
		width: 1.1rem;
		height: 1.1rem;
		margin: 0;
		accent-color: var(--ink);
	}

	.narrow {
		max-width: 28rem;
		margin-bottom: var(--space-5);
	}

	.error {
		font-family: var(--font-ui);
		font-size: var(--step--1);
		color: var(--accent);
	}

	.status {
		margin: var(--space-2) 0 0;
		font-family: var(--font-ui);
		font-size: var(--step--1);
		color: var(--ink-2);
	}

	.status:empty {
		display: none;
	}
</style>
