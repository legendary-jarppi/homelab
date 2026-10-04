<script lang="ts">
	import { enhance } from '$app/forms';

	let { data, form } = $props();
	let pending = $state(false);
	const invalid = (field: string) => (form?.field === field ? true : undefined);
</script>

<svelte:head>
	<title>Join · Shilly Shally News</title>
</svelte:head>

<section class="door">
	{#if data.valid}
		<h1 class="hed hed-4">Welcome to the paper</h1>
		<p class="note">Someone saved you a copy. Choose how you’ll sign in.</p>

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
				<label for="username">Username</label>
				<input id="username" name="username" autocomplete="username" autocapitalize="none" spellcheck="false" required minlength="3" maxlength="32" value={form?.username ?? ''} aria-invalid={invalid('username')} />
				<p class="hint">For signing in. Letters, digits, dots and dashes.</p>
			</div>
			<div class="field">
				<label for="displayName">Your name</label>
				<input id="displayName" name="displayName" autocomplete="name" required maxlength="60" value={form?.displayName ?? ''} aria-invalid={invalid('displayName')} />
			</div>
			<div class="field">
				<label for="password">Password</label>
				<input id="password" name="password" type="password" autocomplete="new-password" required minlength="10" aria-invalid={invalid('password')} aria-describedby="password-hint" />
				<p class="hint" id="password-hint">At least 10 characters. A short sentence works well.</p>
			</div>
			<div class="field">
				<label for="confirm">Password again</label>
				<input id="confirm" name="confirm" type="password" autocomplete="new-password" required minlength="10" aria-invalid={invalid('confirm')} />
			</div>
			<button class="button button-primary" type="submit" disabled={pending}>Join</button>
		</form>
	{:else}
		<h1 class="hed hed-4">This invite can’t be used</h1>
		<p class="note">It has expired or was already used. Ask the person who sent it for a new link.</p>
		<p><a class="button" href="/login">Sign in instead</a></p>
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
