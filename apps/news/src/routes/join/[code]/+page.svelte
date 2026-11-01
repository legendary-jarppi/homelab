<script lang="ts">
	import { enhance } from '$app/forms';
	import { useI18n } from '$lib/i18n';

	let { data, form } = $props();
	const i = useI18n();
	let pending = $state(false);
	const invalid = (field: string) => (form?.field === field ? true : undefined);
</script>

<svelte:head>
	<title>{i.t('join.title')} · Shilly Shally News</title>
</svelte:head>

<section class="door">
	{#if data.valid}
		<h1 class="hed hed-4">{i.t('join.head')}</h1>
		<p class="note">{i.t('join.note')}</p>

		<form
			method="post"
			use:enhance={() => {
				pending = true;
				return async ({ update }) => {
					await update({ reset: false });
					pending = false;
				};
			}}
		>
			{#if form?.message}<p class="error" role="alert">{form.message}</p>{/if}
			<div class="field">
				<label for="username">{i.t('login.username')}</label>
				<input id="username" name="username" autocomplete="username" autocapitalize="none" spellcheck="false" required minlength="3" maxlength="32" value={form?.username ?? ''} aria-invalid={invalid('username')} />
				<p class="hint">{i.t('join.usernameHint')}</p>
			</div>
			<div class="field">
				<label for="displayName">{i.t('join.name')}</label>
				<input id="displayName" name="displayName" autocomplete="name" required maxlength="60" value={form?.displayName ?? ''} aria-invalid={invalid('displayName')} />
			</div>
			<div class="field">
				<label for="password">{i.t('login.password')}</label>
				<input id="password" name="password" type="password" autocomplete="new-password" required minlength="10" aria-invalid={invalid('password')} aria-describedby="password-hint" />
				<p class="hint" id="password-hint">{i.t('join.passwordHint', { n: 10 })}</p>
			</div>
			<div class="field">
				<label for="confirm">{i.t('join.again')}</label>
				<input id="confirm" name="confirm" type="password" autocomplete="new-password" required minlength="10" aria-invalid={invalid('confirm')} />
			</div>
			<button class="button button-primary" type="submit" disabled={pending}>{i.t('join.submit')}</button>
		</form>
	{:else}
		<h1 class="hed hed-4">{i.t('join.invalidHead')}</h1>
		<p class="note">{i.t('join.invalidNote')}</p>
		<p><a class="button" href="/login">{i.t('join.signIn')}</a></p>
	{/if}
</section>

<style>
	.door {
		max-width: 28rem;
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

	form .button {
		width: 100%;
	}
</style>
