<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';

	let { form } = $props();
	let pending = $state(false);
	const next = $derived(page.url.searchParams.get('next'));
</script>

<svelte:head>
	<title>Sign in · Shilly Shally News</title>
</svelte:head>

<section class="door">
	<h1 class="hed hed-4">Sign in</h1>
	<p class="note">A private paper for family and friends.</p>

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
		{#if form?.message}<p class="error" role="alert">{form.message}</p>{/if}
		<div class="field">
			<label for="username">Username</label>
			<input id="username" name="username" autocomplete="username" autocapitalize="none" spellcheck="false" required value={form?.username ?? ''} />
		</div>
		<div class="field">
			<label for="password">Password</label>
			<input id="password" name="password" type="password" autocomplete="current-password" required />
		</div>
		<button class="button button-primary" type="submit" disabled={pending}>Sign in</button>
	</form>
	<p class="aside">New here? Ask whoever invited you for an invite link.</p>
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
