<!--
	A dialog over the dashboard: blurred backdrop, panel, header with a close button. The common
	content styles of the sheets (facts list, form fields, buttons, actions row) live here, applied to
	whatever the sheet holds.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import { fade, fly } from 'svelte/transition';

	let {
		label,
		onclose,
		onescape,
		header,
		children
	}: {
		/** The dialog's accessible name. */
		label: string;
		onclose: () => void;
		/** Escape; closes unless given (e.g. to cancel an edit first). */
		onescape?: () => void;
		/** Left part of the header (the title); the close button is added. */
		header: Snippet;
		children: Snippet;
	} = $props();

	function onkeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') (onescape ?? onclose)();
	}
</script>

<svelte:window {onkeydown} />

<div class="backdrop" transition:fade={{ duration: 180 }} onclick={(e) => e.target === e.currentTarget && onclose()} role="presentation">
	<div class="panel" transition:fly={{ y: 24, duration: 260 }} role="dialog" aria-modal="true" aria-label={label} tabindex="-1">
		<header>
			{@render header()}
			<button class="close" onclick={onclose} aria-label="Close">
				<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18" /></svg>
			</button>
		</header>
		{@render children()}
	</div>
</div>

<style>
	.backdrop {
		position: fixed;
		inset: 0;
		z-index: 50;
		display: grid;
		place-items: center;
		padding: max(16px, env(safe-area-inset-top)) max(16px, env(safe-area-inset-right)) max(16px, env(safe-area-inset-bottom))
			max(16px, env(safe-area-inset-left));
		background: rgba(3, 5, 10, 0.6);
		backdrop-filter: blur(14px);
		-webkit-backdrop-filter: blur(14px);
	}
	.panel {
		width: min(560px, 100%);
		max-height: calc(100dvh - 32px);
		overflow-y: auto;
		overscroll-behavior: contain;
		display: grid;
		gap: 16px;
		padding: 22px 24px 20px;
		background: linear-gradient(180deg, rgba(30, 41, 70, 0.92), rgba(14, 18, 30, 0.95));
		border: 1px solid var(--border);
		border-radius: 28px;
		box-shadow: 0 40px 100px rgba(0, 0, 0, 0.55);
		outline: none;
	}
	header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
	}
	.close {
		width: 40px;
		height: 40px;
		flex: none;
		display: grid;
		place-items: center;
		border: 1px solid var(--border);
		border-radius: 50%;
		background: var(--surface-strong);
		cursor: pointer;
	}
	.close svg {
		width: 18px;
		height: 18px;
		fill: none;
		stroke: currentColor;
		stroke-width: 2;
		stroke-linecap: round;
	}

	/* Content of every sheet. */
	.panel :global(h2) {
		margin: 0;
		font-size: 22px;
		font-weight: 650;
		overflow-wrap: anywhere;
	}
	.panel :global(.facts) {
		margin: 0;
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 12px 18px;
	}
	.panel :global(.facts .wide) {
		grid-column: 1 / -1;
	}
	.panel :global(dt) {
		font-size: 12px;
		color: var(--muted);
	}
	.panel :global(dd) {
		margin: 2px 0 0;
		font-size: 15px;
		font-weight: 550;
		overflow-wrap: anywhere;
	}
	.panel :global(.actions) {
		display: flex;
		flex-wrap: wrap;
		gap: 10px;
		justify-content: space-between;
	}
	.panel :global(form) {
		display: grid;
		gap: 14px;
	}
	.panel :global(label) {
		display: grid;
		gap: 6px;
		font-size: 13px;
		color: var(--muted);
	}
	/* A checkbox with its text on one line. */
	.panel :global(label.check) {
		display: flex;
		align-items: center;
		gap: 10px;
		font-size: 15px;
		color: var(--text);
		cursor: pointer;
	}
	.panel :global(label.check input) {
		width: 20px;
		height: 20px;
		margin: 0;
		accent-color: var(--down);
	}
	.panel :global(:is(input:not([type='checkbox']), select, textarea)) {
		min-width: 0;
		font: inherit;
		font-size: 17px;
		color: var(--text);
		padding: 12px 14px;
		border: 1px solid var(--border);
		border-radius: 14px;
		background: rgba(255, 255, 255, 0.06);
		outline: none;
	}
	.panel :global(:is(input, select, textarea):focus) {
		border-color: var(--down);
	}
	.panel :global(textarea) {
		min-height: 84px;
		resize: vertical;
	}
	.panel :global(:is(.hint, .error)) {
		margin: -6px 0 0;
		font-size: 13px;
	}
	.panel :global(.error) {
		color: var(--bad);
	}
	.panel :global(.button) {
		padding: 12px 18px;
		font-size: 15px;
		font-weight: 600;
		text-align: center;
		text-decoration: none;
		color: var(--text);
		border: 1px solid var(--border);
		border-radius: 14px;
		background: var(--surface-strong);
		cursor: pointer;
	}
	.panel :global(.button.primary) {
		color: #04121c;
		background: var(--down);
		border-color: transparent;
	}
	.panel :global(.button.danger) {
		color: var(--bad);
		background: rgba(248, 113, 113, 0.08);
		border-color: rgba(248, 113, 113, 0.25);
	}
	.panel :global(.button:disabled) {
		opacity: 0.5;
		cursor: not-allowed;
	}
</style>
