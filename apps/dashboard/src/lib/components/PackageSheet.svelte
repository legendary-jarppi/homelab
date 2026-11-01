<script lang="ts">
	import CarrierChip from './CarrierChip.svelte';
	import Sheet from './Sheet.svelte';
	import { dayOf, eventTime } from '$lib/dates';
	import {
		CARRIERS,
		carrierName,
		detectCarrier,
		isLinkOnly,
		LINK_ONLY,
		linkOnlyUntil,
		normalizeCode,
		packageName,
		RETURN_LABEL,
		STATE_LABEL,
		TRACKING_URL
	} from '$lib/packages';
	import type { Carrier, PackageReturn, PackagesData, TrackedPackage } from '$lib/types';

	/** 'add' = add form; 'archive' = the archived packages; a package = its details. */
	let {
		view,
		archive,
		carriers,
		onopen,
		onclose,
		onchange,
		onupdate
	}: {
		view: 'add' | 'archive' | TrackedPackage;
		archive: TrackedPackage[] | null;
		carriers: PackagesData['carriers'];
		onopen: (id: string) => void;
		onclose: () => void;
		/** Added, archived, put back or deleted: the sheet moves on. */
		onchange: () => void;
		/** Renamed, code added or return marked: the sheet stays on the package. */
		onupdate: () => void;
	} = $props();

	const pkg = $derived(typeof view === 'string' ? null : view);
	const title = $derived(view === 'add' ? 'Add a package' : view === 'archive' ? 'Archive' : packageName(view));
	const dateOf = (ms: number) => dayOf(new Date(ms).toISOString());

	/** The code being typed: in the add form, or in the details of a package still without one. */
	let code = $state('');
	let label = $state('');
	/** Explicit choice; otherwise the detected carrier is used. */
	let chosen = $state<Carrier | null>(null);
	let busy = $state(false);
	let message = $state<string | null>(null);

	const detected = $derived(detectCarrier(code));
	const carrier = $derived(chosen ?? detected);
	/** A code was typed and its carrier can be used. */
	const codeReady = $derived(code.trim() !== '' && !!carrier && carriers[carrier]);

	const RETURNS: { id: PackageReturn | null; name: string }[] = [
		{ id: null, name: 'Not returned' },
		{ id: 'partial', name: RETURN_LABEL.partial },
		{ id: 'full', name: RETURN_LABEL.full }
	];

	async function add(event: SubmitEvent) {
		event.preventDefault();
		busy = true;
		message = null;
		try {
			const typed = normalizeCode(code);
			const response = await fetch('/api/packages', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ code: typed || null, label: label.trim() || null, carrier: typed ? carrier : null })
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

	/** PATCHes the open package; its new state, or null with the reason in `message`. */
	async function patch(change: Record<string, unknown>): Promise<TrackedPackage | null> {
		if (!pkg) return null;
		busy = true;
		message = null;
		try {
			const response = await fetch(`/api/packages/${pkg.id}`, {
				method: 'PATCH',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(change)
			});
			if (!response.ok) {
				message = ((await response.json().catch(() => null)) as { message?: string } | null)?.message ?? `Failed (${response.status}).`;
				return null;
			}
			return (await response.json()) as TrackedPackage;
		} finally {
			busy = false;
		}
	}

	async function setArchived(archived: boolean) {
		if (await patch({ archived })) onchange();
	}

	/** Marking an archived package returned puts it back on the card: the sheet goes back to the archive list. */
	async function setReturned(returned: PackageReturn | null) {
		const wasArchived = pkg?.archivedAt != null;
		const p = await patch({ returned });
		if (!p) return;
		if (wasArchived && p.archivedAt === null) onchange();
		else onupdate();
	}

	async function saveCode(event: SubmitEvent) {
		event.preventDefault();
		if (!(await patch({ code: normalizeCode(code), carrier }))) return;
		code = '';
		chosen = null;
		onupdate();
	}

	/** The name being edited; null when not renaming. */
	let renaming = $state<string | null>(null);

	async function saveName(event: SubmitEvent) {
		event.preventDefault();
		if (renaming === null || !(await patch({ label: renaming.trim() || null }))) return;
		renaming = null;
		onupdate();
	}

	/** Escape cancels a rename first. */
	function onescape() {
		if (renaming !== null) renaming = null;
		else onclose();
	}
</script>

{#snippet codeFields(adding: boolean)}
	<label>
		<span>Tracking code {#if adding}<small class="muted">(can be added later)</small>{/if}</span>
		<!-- svelte-ignore a11y_autofocus -->
		<input bind:value={code} autocomplete="off" autocapitalize="characters" spellcheck="false" autofocus={adding} placeholder="JJFI…, MH…, 1Z…, 00340…" />
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
		{#if carrier && LINK_ONLY[carrier]}{carrierName(carrier)} shares status only with business customers: the card links to its tracking page.
		{:else if chosen}Carrier chosen by hand.{:else if detected}Detected from the code.{:else if code.length > 5}Choose the carrier.{:else}The carrier is detected from the code.{/if}
	</p>
{/snippet}

<Sheet label={title} {onclose} {onescape}>
	{#snippet header()}
		{#if pkg && renaming !== null}
			<form class="rename" onsubmit={saveName}>
				<!-- svelte-ignore a11y_autofocus -->
				<input bind:value={renaming} maxlength="40" placeholder={pkg.code ?? 'Name'} aria-label="Name" autocomplete="off" autofocus />
				<button class="button primary" disabled={busy}>Save</button>
			</form>
		{:else}
			<span class="titlebar">
				<h2>{title}</h2>
				{#if pkg}
					<button class="edit" onclick={() => (renaming = pkg.label ?? '')} aria-label="Rename" title="Rename">
						<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4" /></svg>
					</button>
				{/if}
			</span>
		{/if}
	{/snippet}

		{#if view === 'archive'}
			{#if archive === null}
				<p class="muted">Loading…</p>
			{:else if archive.length === 0}
				<p class="muted">Nothing archived yet. Archive a package from its details; delivered packages move here on their own two days after delivery.</p>
			{:else}
				<ul class="archived">
					{#each archive as p (p.id)}
						<li>
							<button onclick={() => onopen(p.id)}>
								<CarrierChip carrier={p.carrier} />
								<span class="name">{packageName(p)}</span>
								<span class="muted">{p.returned ? RETURN_LABEL[p.returned] : !p.carrier ? 'No tracking code' : LINK_ONLY[p.carrier] ? carrierName(p.carrier) : STATE_LABEL[p.tracking?.state ?? 'unknown']}</span>
								<span class="muted num when">{p.archivedAt ? dateOf(p.archivedAt) : ''}</span>
							</button>
						</li>
					{/each}
				</ul>
			{/if}
		{:else if pkg}
			{@const t = pkg.tracking}
			{@const linkOnly = isLinkOnly(pkg)}
			<dl class="facts">
				<div>
					<dt>Status</dt>
					<dd>{!pkg.carrier ? 'No tracking code yet' : linkOnly ? `On ${carrierName(pkg.carrier)}'s website` : STATE_LABEL[t?.state ?? 'unknown']}</dd>
				</div>
				{#if pkg.carrier}
					<div><dt>Carrier</dt><dd>{carrierName(pkg.carrier)}</dd></div>
					<div><dt>Code</dt><dd class="num">{pkg.code}</dd></div>
				{:else}
					<div><dt>Added</dt><dd>{dateOf(pkg.addedAt)}</dd></div>
				{/if}
				{#if pkg.returned}<div><dt>{RETURN_LABEL[pkg.returned]}</dt><dd class="warn">{pkg.returnedAt ? dateOf(pkg.returnedAt) : ''}</dd></div>{/if}
				{#if linkOnly && pkg.archivedAt === null && !pkg.returned}<div><dt>On the card until</dt><dd>{dateOf(linkOnlyUntil(pkg))}</dd></div>{/if}
				{#if pkg.archivedAt}<div><dt>Archived</dt><dd>{dateOf(pkg.archivedAt)}</dd></div>{/if}
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
			{#if !pkg.carrier}
				<form class="code" onsubmit={saveCode}>
					{@render codeFields(false)}
					<button class="button primary" disabled={busy || !codeReady}>Save the code</button>
				</form>
			{/if}
			<div class="returns" role="radiogroup" aria-label="Returned">
				{#each RETURNS as r (r.id)}
					<button type="button" role="radio" aria-checked={pkg.returned === r.id} class:active={pkg.returned === r.id} disabled={busy} onclick={() => setReturned(r.id)}>
						{r.name}
					</button>
				{/each}
			</div>
			<p class="hint muted">
				{#if pkg.returned}Stays on the card until the refund has come: then <em>Refund received</em> archives it.
				{:else}A returned package stays on the card until its refund has come.{/if}
			</p>
			{#if message}<p class="error">{message}</p>{/if}
			<div class="actions">
				{#if pkg.carrier && pkg.code}
					<a class="button" href={TRACKING_URL[pkg.carrier](pkg.code)} target="_blank" rel="noopener noreferrer">Open at {carrierName(pkg.carrier)}</a>
				{/if}
				<span class="end">
					{#if pkg.archivedAt}
						<button class="button" onclick={() => setArchived(false)} disabled={busy}>Back to the card</button>
					{:else}
						<button class="button" onclick={() => setArchived(true)} disabled={busy}>{pkg.returned ? 'Refund received' : 'Archive'}</button>
					{/if}
					<button class="button danger" onclick={remove} disabled={busy}>Delete</button>
				</span>
			</div>
		{:else}
			<form onsubmit={add}>
				{@render codeFields(true)}
				<label>
					<span>Name <small class="muted">{code.trim() ? '(optional)' : '(needed without a code)'}</small></span>
					<input bind:value={label} autocomplete="off" maxlength="40" placeholder="e.g. Shoes" />
				</label>
				{#if message}<p class="error">{message}</p>{/if}
				<button class="button primary" disabled={busy || (code.trim() ? !codeReady : !label.trim())}>{busy ? 'Adding…' : 'Add'}</button>
			</form>
	{/if}
</Sheet>

<style>
	.titlebar {
		display: flex;
		align-items: center;
		gap: 8px;
		min-width: 0;
	}
	.edit {
		width: 32px;
		height: 32px;
		flex: none;
		display: grid;
		place-items: center;
		color: var(--muted);
		border: 0;
		border-radius: 50%;
		background: transparent;
		cursor: pointer;
	}
	.edit svg {
		width: 18px;
		height: 18px;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.8;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
	.rename {
		flex: 1;
		min-width: 0;
		display: flex;
		gap: 8px;
	}
	.rename input {
		flex: 1;
		min-width: 0;
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
	.actions .end {
		display: flex;
		gap: 10px;
		margin-left: auto;
	}
	/* Adding the code to a package that came without one. */
	.code {
		padding-top: 12px;
		border-top: 1px solid var(--border);
	}
	.archived {
		margin: 0 -10px;
		padding: 0;
		list-style: none;
		display: grid;
		gap: 2px;
	}
	.archived button {
		width: 100%;
		display: grid;
		grid-template-columns: 52px minmax(0, 1fr) auto;
		grid-template-areas: 'chip name when' 'chip state when';
		align-items: center;
		column-gap: 12px;
		row-gap: 2px;
		padding: 8px 10px;
		font: inherit;
		text-align: left;
		color: var(--text);
		border: 0;
		border-radius: 14px;
		background: transparent;
		cursor: pointer;
	}
	.archived button:active {
		background: var(--surface-strong);
	}
	.archived button > :global(.carrier) {
		grid-area: chip;
		align-self: start;
	}
	.archived .name {
		grid-area: name;
		font-size: 15px;
		font-weight: 600;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.archived .muted:not(.when) {
		grid-area: state;
		font-size: 13px;
	}
	.archived .when {
		grid-area: when;
		font-size: 13px;
	}
	.carriers,
	.returns {
		display: grid;
		grid-template-columns: repeat(2, 1fr);
		gap: 4px;
		padding: 4px;
		border-radius: 14px;
		background: rgba(255, 255, 255, 0.06);
	}
	:is(.carriers, .returns) button {
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
	:is(.carriers, .returns) button.active {
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
	.returns {
		grid-template-columns: repeat(3, 1fr);
	}
	.returns button {
		padding: 9px 4px;
		font-size: 14px;
	}
</style>
