<script lang="ts">
	import Card from './Card.svelte';
	import PackageSheet from './PackageSheet.svelte';
	import { dayOf, eventTime } from '$lib/dates';
	import { carrierName, LINK_ONLY, linkOnlyUntil, STATE_LABEL } from '$lib/packages';
	import type { PackageState, PackagesData, TrackedPackage } from '$lib/types';

	let { data, onchange }: { data: PackagesData | null; onchange: () => void } = $props();

	/** null = closed; 'add' = add form; otherwise the package whose details are open. */
	let sheet = $state<'add' | string | null>(null);
	const open = $derived(sheet && sheet !== 'add' ? (data?.packages.find((p) => p.id === sheet) ?? null) : null);

	/** Arriving soonest first: pickups and deliveries today, then the rest; delivered last. */
	const ORDER: Record<PackageState, number> = { pickup: 0, out: 1, exception: 2, transit: 3, info: 4, unknown: 5, delivered: 6 };
	const packages = $derived(
		[...(data?.packages ?? [])].sort((a, b) => ORDER[a.tracking?.state ?? 'unknown'] - ORDER[b.tracking?.state ?? 'unknown'] || b.addedAt - a.addedAt)
	);
	const waiting = $derived(packages.filter((p) => p.tracking?.state === 'pickup').length);

	/** Four steps: sent, on the way, out for delivery / at the pickup point, delivered. */
	function step(state: PackageState): number {
		return { unknown: 0, info: 1, transit: 2, exception: 2, out: 3, pickup: 3, delivered: 4 }[state];
	}
	function detail(p: TrackedPackage): string {
		const t = p.tracking;
		if (!t) return p.error ?? 'Checking…';
		if (t.state === 'pickup' && t.pickup) return [t.pickup.name, t.pickup.until ? `by ${dayOf(t.pickup.until)}` : null].filter(Boolean).join(' · ');
		const latest = t.events[0];
		const when = latest?.time ? eventTime(latest.time) : null;
		if (t.eta && t.state !== 'delivered') return [`Arriving ${dayOf(t.eta)}`, t.summary].filter(Boolean).join(' · ');
		return [when, t.summary].filter(Boolean).join(' · ') || (p.error ?? '');
	}
</script>

<Card title="Packages">
	{#snippet accessory()}
		<span class="head">
			{#if waiting > 0}<span class="waiting">{waiting} to pick up</span>{/if}
			<button class="add" onclick={() => (sheet = 'add')} aria-label="Add a package">
				<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>Add
			</button>
		</span>
	{/snippet}
	{#if !data}
		<p class="muted">Package tracking unavailable.</p>
	{:else if packages.length === 0}
		<p class="muted empty">No packages on the way. Add one with its tracking code.</p>
	{:else}
		<ul class="list">
			{#each packages as p (p.id)}
				{@const state = p.tracking?.state ?? 'unknown'}
				{@const linkOnly = LINK_ONLY.has(p.carrier)}
				<li>
					<button class="row {state}" class:link-only={linkOnly} onclick={() => (sheet = p.id)}>
						<span class="carrier {p.carrier}">{carrierName(p.carrier)}</span>
						<span class="main">
							<span class="line">
								<span class="name">{p.label ?? p.code}</span>
								<span class="state">{linkOnly ? `Check at ${carrierName(p.carrier)}` : STATE_LABEL[state]}</span>
							</span>
							{#if linkOnly}
								<span class="detail muted">On the card until {dayOf(new Date(linkOnlyUntil(p)).toISOString())}</span>
							{:else}
								<span class="detail muted">{detail(p)}</span>
								<span class="steps" aria-hidden="true">
									{#each [1, 2, 3, 4] as s (s)}<i class:done={step(state) >= s}></i>{/each}
								</span>
							{/if}
						</span>
					</button>
				</li>
			{/each}
		</ul>
	{/if}
</Card>

{#if sheet !== null && data}
	<PackageSheet
		pkg={open}
		carriers={data.carriers}
		onclose={() => (sheet = null)}
		onchange={() => {
			sheet = null;
			onchange();
		}}
	/>
{/if}

<style>
	.head {
		display: inline-flex;
		align-items: center;
		gap: 10px;
	}
	.waiting {
		color: var(--warn);
		font-weight: 600;
	}
	.add {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		padding: 5px 12px 5px 8px;
		font-size: 13px;
		font-weight: 600;
		color: var(--text);
		border: 1px solid var(--border);
		border-radius: 999px;
		background: var(--surface-strong);
		cursor: pointer;
	}
	.add svg {
		width: 16px;
		height: 16px;
		fill: none;
		stroke: currentColor;
		stroke-width: 2.2;
		stroke-linecap: round;
	}
	p {
		margin: 0;
		font-size: 14px;
	}
	.list {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		margin: 0 -8px;
		padding: 0;
		list-style: none;
		display: grid;
		align-content: start;
		gap: 2px;
		scrollbar-width: none;
	}
	.row {
		width: 100%;
		display: grid;
		grid-template-columns: 52px minmax(0, 1fr);
		align-items: start;
		gap: 10px;
		padding: 7px 8px;
		border: 0;
		border-radius: 14px;
		background: transparent;
		text-align: left;
		cursor: pointer;
		--s: var(--muted);
	}
	.row:active {
		background: var(--surface-strong);
	}
	.row.transit,
	.row.info {
		--s: var(--down);
	}
	.row.out {
		--s: var(--up);
	}
	.row.pickup {
		--s: var(--warn);
	}
	.row.delivered {
		--s: var(--ok);
		opacity: 0.6;
	}
	.row.exception {
		--s: var(--bad);
	}
	.row.link-only {
		--s: var(--text);
	}
	.carrier {
		margin-top: 1px;
		padding: 3px 0;
		font-size: 11px;
		font-weight: 800;
		letter-spacing: 0.02em;
		text-align: center;
		border-radius: 7px;
	}
	.carrier.posti {
		color: #fff;
		background: #ff6b00;
	}
	.carrier.dhl {
		color: #d40511;
		background: #ffcc00;
	}
	.carrier.ups {
		color: #ffb500;
		background: #351c15;
	}
	.main {
		display: grid;
		gap: 3px;
		min-width: 0;
	}
	.line {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 10px;
		min-width: 0;
	}
	.name {
		font-size: 15px;
		font-weight: 600;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.state {
		flex: none;
		font-size: 13px;
		font-weight: 600;
		color: var(--s);
	}
	.detail {
		font-size: 12px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.steps {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 3px;
		margin-top: 2px;
	}
	.steps i {
		height: 3px;
		border-radius: 2px;
		background: rgba(255, 255, 255, 0.08);
	}
	.steps i.done {
		background: var(--s);
	}
</style>
