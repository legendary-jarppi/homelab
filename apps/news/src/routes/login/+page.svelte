<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import { useI18n } from '$lib/i18n';

	let { form } = $props();
	const i = useI18n();
	let pending = $state(false);
	const next = $derived(page.url.searchParams.get('next'));
	/** Set by /login/check: the password was accepted but the browser sent no session cookie back. */
	const cookieMissing = $derived(page.url.searchParams.get('cookie') === 'missing');
</script>

<svelte:head>
	<title>{i.t('login.title')} · Shilly Shally News</title>
</svelte:head>

<section class="door">
	<h1 class="hed hed-4">{i.t('login.title')}</h1>
	<p class="note">{i.t('login.note')}</p>

	<form
		method="post"
		action={next ? `?next=${encodeURIComponent(next)}` : undefined}
		use:enhance={() => {
			pending = true;
			return async ({ update }) => {
				await update({ reset: false });
				pending = false;
			};
		}}
	>
		{#if form?.message}
			<p class="error" role="alert">{form.message}</p>
		{:else if cookieMissing}
			<p class="error" role="alert">
				{i.t('login.cookieLead')} <b>{i.t('login.cookieSetting')}</b>{i.t('login.cookieMid')} <b>news.lab.internal</b>{i.t('login.cookieEnd')}
			</p>
		{/if}
		<div class="field">
			<label for="username">{i.t('login.username')}</label>
			<input id="username" name="username" autocomplete="username" autocapitalize="none" spellcheck="false" required value={form?.username ?? ''} />
		</div>
		<div class="field">
			<label for="password">{i.t('login.password')}</label>
			<input id="password" name="password" type="password" autocomplete="current-password" required />
		</div>
		<button class="button button-primary" type="submit" disabled={pending}>{i.t('login.submit')}</button>
	</form>
	<p class="aside">{i.t('login.aside')}</p>
</section>

<style>
	.door {
		max-width: 26rem;
		margin: var(--space-7) auto;
	}

	.note {
		margin: var(--space-2) 0 var(--space-5);
	}

	.error {
		margin-bottom: var(--space-4);
		padding: var(--space-3) var(--space-4);
		border-left: 3px solid var(--accent);
		font-family: var(--font-ui);
		font-size: var(--step--1);
	}

	.button {
		width: 100%;
	}

	.aside {
		margin-top: var(--space-5);
		font-family: var(--font-ui);
		font-size: var(--step--1);
		color: var(--ink-2);
	}
</style>
