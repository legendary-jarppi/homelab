<script lang="ts">
	import { enhance } from '$app/forms';
	import BlockedWords from '$lib/components/account/BlockedWords.svelte';
	import DisplayFields from '$lib/components/account/DisplayFields.svelte';
	import { autosubmit, keepValues } from '$lib/components/account/forms';
	import PresetCards from '$lib/components/account/PresetCards.svelte';
	import SensitivityEditor from '$lib/components/account/SensitivityEditor.svelte';
	import TopicsForm from '$lib/components/account/TopicsForm.svelte';
	import { PRESETS } from '$lib/core/taxonomy';

	let { data, form } = $props();

	let interactive = $state(false);
	$effect(() => {
		interactive = true;
	});

	const SECTIONS = [
		['comfort', 'Comfort level'],
		['sensitivity', 'Sensitivity'],
		['topics', 'Topics'],
		['outlets', 'Papers'],
		['words', 'Blocked words'],
		['display', 'Photos & headlines'],
		['theme', 'Theme'],
		['account', 'Account']
	] as const;

	const THEMES = [
		{ value: 'system', label: 'Follow this device' },
		{ value: 'light', label: 'Light' },
		{ value: 'dark', label: 'Dark' }
	] as const;

	const confirmPreset = $derived(form?.confirmPreset ? PRESETS.find((p) => p.key === form.confirmPreset) : null);
	const errorFor = (section: string) => (form?.section === section ? form.message : null);
</script>

<svelte:head>
	<title>Settings · Shilly Shally News</title>
</svelte:head>

<div class="settings">
	<header>
		<p class="kicker">Your paper</p>
		<h1 class="hed hed-5">Settings</h1>
		<p class="note">Changes apply from the next page you open.</p>
		<nav aria-label="Settings sections">
			<ul class="toc">
				{#each SECTIONS as [id, label] (id)}
					<li><a href="#{id}">{label}</a></li>
				{/each}
			</ul>
		</nav>
	</header>

	<section id="comfort" aria-labelledby="comfort-head">
		<h2 class="section-head" id="comfort-head">Comfort level</h2>
		<p class="intro">A comfort level sets every subject below at once. Last chosen: {PRESETS.find((p) => p.key === data.settings.preset)?.label ?? 'none'}.</p>
		{#if confirmPreset}
			<form class="confirm" method="POST" action="?/preset" use:enhance>
				<input type="hidden" name="preset" value={confirmPreset.key} />
				<input type="hidden" name="confirm" value="yes" />
				<p>
					Use <strong>{confirmPreset.label}</strong>? This replaces the choice you have made for each subject under Sensitivity.
				</p>
				<div class="actions">
					<button class="button button-primary">Replace my choices</button>
					<a class="button" href="/settings#comfort">Keep my choices</a>
				</div>
			</form>
		{:else}
			<form method="POST" action="?/preset" use:enhance>
				<PresetCards selected={data.settings.preset} />
				<button class="button">Use this comfort level</button>
			</form>
		{/if}
		{#if errorFor('comfort')}<p class="error" role="alert">{errorFor('comfort')}</p>{/if}
		<p class="status" aria-live="polite">{form?.saved === 'comfort' ? 'Comfort level applied.' : ''}</p>
	</section>

	<section id="sensitivity" aria-labelledby="sensitivity-head">
		<h2 class="section-head" id="sensitivity-head">Sensitivity</h2>
		<p class="intro">For each group, choose what to leave out. Setting a group sets every subject in it; you can then change single subjects.</p>
		<SensitivityEditor thresholds={data.thresholds} saved={form?.saved ?? null} />
	</section>

	<section id="topics" aria-labelledby="topics-head">
		<h2 class="section-head" id="topics-head">Topics</h2>
		<p class="intro">Untick a topic to leave it out of your paper.</p>
		<TopicsForm hidden={data.hiddenTopics} />
		<p class="status" aria-live="polite">{form?.saved === 'topics' ? 'Saved.' : ''}</p>
	</section>

	<section id="outlets" aria-labelledby="outlets-head">
		<h2 class="section-head" id="outlets-head">Papers</h2>
		<p class="intro">Untick a paper to leave out everything it publishes.</p>
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
				<button class="button">Save papers</button>
			{/if}
		</form>
		<p class="status" aria-live="polite">{form?.saved === 'outlets' ? 'Saved.' : ''}</p>
	</section>

	<section id="words" aria-labelledby="words-head">
		<h2 class="section-head" id="words-head">Blocked words</h2>
		<BlockedWords terms={data.terms} maxLength={data.maxTermLength} />
		{#if errorFor('words')}<p class="error" role="alert">{errorFor('words')}</p>{/if}
		<p class="status" aria-live="polite">{form?.saved === 'words' ? 'Saved.' : ''}</p>
	</section>

	<section id="display" aria-labelledby="display-head">
		<h2 class="section-head" id="display-head">Photos & headlines</h2>
		<form method="POST" action="?/display" use:enhance={keepValues} use:autosubmit>
			<DisplayFields images={data.settings.images} calmHeadlines={data.settings.calmHeadlines} />
			{#if !interactive}
				<button class="button">Save</button>
			{/if}
		</form>
		{#if errorFor('display')}<p class="error" role="alert">{errorFor('display')}</p>{/if}
		<p class="status" aria-live="polite">{form?.saved === 'display' ? 'Saved.' : ''}</p>
	</section>

	<section id="theme" aria-labelledby="theme-head">
		<h2 class="section-head" id="theme-head">Theme</h2>
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
				<legend class="visually-hidden">Theme</legend>
				{#each THEMES as theme (theme.value)}
					<label>
						<input type="radio" name="theme" value={theme.value} checked={data.settings.theme === theme.value} />
						<span>{theme.label}</span>
					</label>
				{/each}
			</fieldset>
			{#if !interactive}
				<button class="button">Save theme</button>
			{/if}
		</form>
	</section>

	<section id="account" aria-labelledby="account-head">
		<h2 class="section-head" id="account-head">Account</h2>
		<p class="intro">Signed in as <strong>{data.username}</strong>.</p>

		<form class="narrow" method="POST" action="?/name" use:enhance={keepValues}>
			<div class="field">
				<label for="display-name">Your name</label>
				<input id="display-name" name="displayName" value={data.displayName} required maxlength="60" autocomplete="name" />
			</div>
			<button class="button">Save name</button>
			{#if errorFor('account')}<p class="error" role="alert">{errorFor('account')}</p>{/if}
			<p class="status" aria-live="polite">{form?.saved === 'name' ? 'Saved.' : ''}</p>
		</form>

		<form class="narrow" method="POST" action="?/password" use:enhance>
			<h3>Change password</h3>
			<div class="field">
				<label for="current-password">Current password</label>
				<input id="current-password" name="current" type="password" required autocomplete="current-password" />
			</div>
			<div class="field">
				<label for="new-password">New password</label>
				<input id="new-password" name="next" type="password" required minlength={data.minPasswordLength} autocomplete="new-password" />
				<span class="hint">At least {data.minPasswordLength} characters. Other devices will need to sign in again.</span>
			</div>
			<div class="field">
				<label for="confirm-password">New password again</label>
				<input id="confirm-password" name="confirm" type="password" required minlength={data.minPasswordLength} autocomplete="new-password" />
			</div>
			<button class="button">Change password</button>
			{#if errorFor('password')}<p class="error" role="alert">{errorFor('password')}</p>{/if}
			<p class="status" aria-live="polite">{form?.saved === 'password' ? 'Password changed.' : ''}</p>
		</form>

		<form class="narrow" method="POST" action="?/signOutAll">
			<h3>Sign out everywhere</h3>
			<p class="intro">Ends every session, on this device too. You will need to sign in again.</p>
			<button class="button">Sign out everywhere</button>
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
