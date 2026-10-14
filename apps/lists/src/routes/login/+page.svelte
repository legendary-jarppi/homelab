<script lang="ts">
	import { enhance } from '$app/forms';

	let { form } = $props();
	let submitting = $state(false);
</script>

<svelte:head><title>Lists</title></svelte:head>

<main>
	<form
		method="POST"
		use:enhance={() => {
			submitting = true;
			return async ({ update }) => {
				await update();
				submitting = false;
			};
		}}
	>
		<div class="mark" aria-hidden="true">
			<svg viewBox="0 0 24 24"><path d="M4 6h2v2H4zm4 0h12v2H8zm-4 5h2v2H4zm4 0h12v2H8zm-4 5h2v2H4zm4 0h12v2H8z" /></svg>
		</div>
		<h1>Lists</h1>
		<p class="muted">Enter the passcode to continue.</p>
		<input name="passcode" type="password" autocomplete="current-password" placeholder="Passcode" aria-label="Passcode" required />
		{#if form?.error}<p class="error" role="alert">{form.error}</p>{/if}
		<button type="submit" disabled={submitting}>{submitting ? 'Checking…' : 'Unlock'}</button>
	</form>
</main>

<style>
	main {
		min-height: 100dvh;
		display: grid;
		place-items: center;
		padding: 24px;
	}
	form {
		width: min(360px, 100%);
		display: grid;
		gap: 14px;
		padding: 36px 28px 28px;
		text-align: center;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 28px;
		backdrop-filter: blur(24px) saturate(140%);
		-webkit-backdrop-filter: blur(24px) saturate(140%);
		box-shadow: 0 30px 80px rgba(0, 0, 0, 0.45);
	}
	.mark {
		width: 64px;
		height: 64px;
		margin: 0 auto 4px;
		display: grid;
		place-items: center;
		border-radius: 20px;
		background: linear-gradient(135deg, #38bdf8, #c084fc);
		box-shadow: 0 12px 30px rgba(56, 189, 248, 0.25);
	}
	.mark svg {
		width: 30px;
		height: 30px;
		fill: white;
	}
	h1 {
		font-size: 28px;
	}
	input {
		width: 100%;
		padding: 15px 18px;
		font-size: 18px;
		text-align: center;
		color: var(--text);
		background: rgba(0, 0, 0, 0.3);
		border: 1px solid var(--border);
		border-radius: 16px;
		outline: none;
	}
	input:focus {
		border-color: var(--accent);
	}
	button {
		padding: 15px;
		font-size: 17px;
		font-weight: 600;
		border: 0;
		border-radius: 16px;
		background: linear-gradient(135deg, #0ea5e9, #8b5cf6);
		cursor: pointer;
	}
	button:disabled {
		opacity: 0.6;
	}
</style>
