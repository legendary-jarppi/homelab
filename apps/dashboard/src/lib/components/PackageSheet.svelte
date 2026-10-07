<script lang="ts">
	import { fade, fly } from 'svelte/transition';
	import { dayOf, eventTime } from '$lib/dates';
	import { CARRIERS, carrierName, detectCarrier, LINK_ONLY, linkOnlyUntil, normalizeCode, STATE_LABEL, TRACKING_URL } from '$lib/packages';
	import type { Carrier, PackagesData, TrackedPackage } from '$lib/types';

	/** `pkg` null = add form; otherwise that package's details. */
	let {
		pkg,
		carriers,
		onclose,
		onchange
	}: { pkg: TrackedPackage | null; carriers: PackagesData['carriers']; onclose: () => void; onchange: () => void } = $props();

	let code = $state('');
	let label = $state('');
	/** Explicit choice; otherwise the detected carrier is used. */
	let chosen = $state<Carrier | null>(null);
	let busy = $state(false);
	let message = $state<string | null>(null);

	const detected = $derived(detectCarrier(code));
	const carrier = $derived(chosen ?? detected);

	async function add(event: SubmitEvent) {
		event.preventDefault();
		busy = true;
		message = null;
		try {
			const response = await fetch('/api/packages', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ code: normalizeCode(code), label: label.trim() || null, carrier })
			});
			if (!response.ok) {
				message = ((await response.json().catch(() => null)) as { message?: string } | null)?.message ?? `Could not add (${response.status}).`;
				return;
			}
			onchange();
		} finally {
			busy = false;
		}
	}

	async function remove() {
		if (!pkg) return;
		busy = true;
		await fetch(`/api/packages/${pkg.id}`, { method: 'DELETE' });
		busy = false;
		onchange();
	}

	function onkeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') onclose();
	}
</script>

<svelte:window {onkeydown} />

<div class="backdrop" transition:fade={{ duration: 180 }} onclick={(e) => e.target === e.currentTarget && onclose()} role="presentation">
	<div class="panel" transition:fly={{ y: 24, duration: 260 }} role="dialog" aria-modal="true" aria-label={pkg ? 'Package details' : 'Add a package'} tabindex="-1">
		<header>
			<h2>{pkg ? (pkg.label ?? pkg.code) : 'Add a package'}</h2>
			<button class="close" onclick={onclose} aria-label="Close">
				<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18" /></svg>
			</button>
		</header>

		{#if pkg}
			{@const t = pkg.tracking}
			{@const linkOnly = LINK_ONLY.has(pkg.carrier)}
			<dl class="facts">
				<div><dt>Status</dt><dd>{linkOnly ? `On ${carrierName(pkg.carrier)}'s website` : STATE_LABEL[t?.state ?? 'unknown']}</dd></div>
				<div><dt>Carrier</dt><dd>{carrierName(pkg.carrier)}</dd></div>
				<div><dt>Code</dt><dd class="num">{pkg.code}</dd></div>
				{#if linkOnly}<div><dt>On the card until</dt><dd>{dayOf(new Date(linkOnlyUntil(pkg)).toISOString())}</dd></div>{/if}
				{#if t?.eta}<div><dt>Arriving</dt><dd>{dayOf(t.eta)}</dd></div>{/if}
				{#if t?.pickup}
					<div class="wide">
						<dt>Pick up at</dt>
						<dd>{t.pickup.name}{#if t.pickup.address}<span class="muted">{` · ${t.pickup.address}`}</span>{/if}{#if t.pickup.until}<br /><span class="warn">By {dayOf(t.pickup.until)}</span>{/if}</dd>
					</div>
				{/if}
				{#if pkg.error && !linkOnly}<div class="wide"><dt>Last check</dt><dd class="muted">{pkg.error}</dd></div>{/if}
			</dl>
			{#if t && t.events.length > 0}
				<ol class="events">
					{#each t.events as e, i (i)}
						<li class:latest={i === 0}>
							<span class="when muted num">{e.time ? eventTime(e.time) : ''}</span>
							<span>{e.description}{#if e.location}<span class="muted">{` · ${e.location}`}</span>{/if}</span>
						</li>
					{/each}
				</ol>
			{/if}
			<div class="actions">
				<a class="button" href={TRACKING_URL[pkg.carrier](pkg.code)} target="_blank" rel="noopener noreferrer">Open at {carrierName(pkg.carrier)}</a>
				<button class="button danger" onclick={remove} disabled={busy}>Remove</button>
			</div>
		{:else}
			<form onsubmit={add}>
				<label>
					<span>Tracking code</span>
					<!-- svelte-ignore a11y_autofocus -->
					<input bind:value={code} autocomplete="off" autocapitalize="characters" spellcheck="false" autofocus required placeholder="JJFI…, 1Z…, 00340…" />
				</label>
				<label>
					<span>Name <small class="muted">(optional)</small></span>
					<input bind:value={label} autocomplete="off" maxlength="40" placeholder="e.g. Shoes" />
				</label>
				<div class="carriers" role="radiogroup" aria-label="Carrier">
					{#each CARRIERS as c (c.id)}
						<button
							type="button"
							role="radio"
							aria-checked={carrier === c.id}
							class:active={carrier === c.id}
							disabled={!carriers[c.id]}
							title={carriers[c.id] ? '' : `${c.name} tracking is not set up yet`}
							onclick={() => (chosen = c.id)}
						>
							{c.name}{#if !carriers[c.id]}<small>not set up</small>{/if}
						</button>
					{/each}
				</div>
				<p class="hint muted">
					{#if carrier && LINK_ONLY.has(carrier)}{carrierName(carrier)} shares status only with business customers: the card links to its tracking page.
					{:else if chosen}Carrier chosen by hand.{:else if detected}Detected from the code.{:else if code.length > 5}Choose the carrier.{:else}The carrier is detected from the code.{/if}
				</p>
				{#if message}<p class="error">{message}</p>{/if}
				<button class="button primary" disabled={busy || !carrier || !carriers[carrier]}>{busy ? 'Adding…' : 'Add'}</button>
			</form>
		{/if}
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
	h2 {
		margin: 0;
		font-size: 22px;
		font-weight: 650;
		overflow-wrap: anywhere;
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
	.facts {
		margin: 0;
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 12px 18px;
	}
	.facts .wide {
		grid-column: 1 / -1;
	}
	dt {
		font-size: 12px;
		color: var(--muted);
	}
	dd {
		margin: 2px 0 0;
		font-size: 15px;
		font-weight: 550;
		overflow-wrap: anywhere;
	}
	.warn {
		color: var(--warn);
	}
	.events {
		margin: 0;
		padding: 12px 0 0;
		list-style: none;
		display: grid;
		gap: 9px;
		border-top: 1px solid var(--border);
		font-size: 14px;
	}
	.events li {
		display: grid;
		grid-template-columns: 104px minmax(0, 1fr);
		gap: 12px;
		opacity: 0.75;
	}
	.events li.latest {
		opacity: 1;
		font-weight: 600;
	}
	.when {
		font-size: 13px;
	}
	.actions {
		display: flex;
		gap: 10px;
		justify-content: space-between;
	}
	form {
		display: grid;
		gap: 14px;
	}
	label {
		display: grid;
		gap: 6px;
		font-size: 13px;
		color: var(--muted);
	}
	input {
		font: inherit;
		font-size: 17px;
		color: var(--text);
		padding: 12px 14px;
		border: 1px solid var(--border);
		border-radius: 14px;
		background: rgba(255, 255, 255, 0.06);
		outline: none;
	}
	input:focus {
		border-color: var(--down);
	}
	.carriers {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 4px;
		padding: 4px;
		border-radius: 14px;
		background: rgba(255, 255, 255, 0.06);
	}
	.carriers button {
		display: grid;
		padding: 9px 0;
		font-size: 15px;
		font-weight: 600;
		border: 0;
		border-radius: 10px;
		background: transparent;
		color: var(--muted);
		cursor: pointer;
	}
	.carriers button.active {
		background: rgba(255, 255, 255, 0.16);
		color: var(--text);
	}
	.carriers button:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}
	.carriers small {
		font-size: 11px;
		font-weight: 500;
	}
	.hint,
	.error {
		margin: -6px 0 0;
		font-size: 13px;
	}
	.error {
		color: var(--bad);
	}
	.button {
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
	.button.primary {
		color: #04121c;
		background: var(--down);
		border-color: transparent;
	}
	.button.danger {
		color: var(--bad);
		background: rgba(248, 113, 113, 0.08);
		border-color: rgba(248, 113, 113, 0.25);
	}
	.button:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
</style>
