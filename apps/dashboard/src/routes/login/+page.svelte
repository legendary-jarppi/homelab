<script lang="ts">
	import { enhance } from '$app/forms';

	let { form } = $props();
	let submitting = $state(false);
</script>

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
			<svg viewBox="0 0 24 24"><path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" /></svg>
		</div>
		<h1>Home</h1>
		<p class="muted">Enter the passcode to continue.</p>
		<input
			name="passcode"
			type="password"
			autocomplete="current-password"
			placeholder="Passcode"
			aria-label="Passcode"
			required
		/>
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
		background: linear-gradient(135deg, var(--down), var(--up));
		box-shadow: 0 12px 30px rgba(56, 189, 248, 0.25);
	}
	.mark svg {
		width: 30px;
		height: 30px;
		fill: white;
	}
	h1 {
		margin: 0;
		font-size: 28px;
		font-weight: 650;
		letter-spacing: -0.02em;
	}
	p {
		margin: 0;
	}
	input {
		width: 100%;
		padding: 15px 18px;
		font: inherit;
		font-size: 18px;
		text-align: center;
		color: var(--text);
		background: rgba(0, 0, 0, 0.3);
		border: 1px solid var(--border);
		border-radius: 16px;
		outline: none;
		transition: border-color 0.2s;
	}
	input:focus {
		border-color: var(--down);
	}
	.error {
		color: var(--bad);
		font-size: 15px;
	}
	button {
		padding: 15px;
		font-size: 17px;
		font-weight: 600;
		border: 0;
		border-radius: 16px;
		background: linear-gradient(135deg, #0ea5e9, #8b5cf6);
		cursor: pointer;
		transition: opacity 0.2s, transform 0.1s;
	}
	button:active {
		transform: scale(0.98);
	}
	button:disabled {
		opacity: 0.6;
	}
</style>
