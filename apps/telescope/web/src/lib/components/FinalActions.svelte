<script lang="ts">
	import { downloadUrl, type FinalsData } from '$lib/finals.svelte';
	import { nightLabel } from '$lib/format';

	/**
	 * D3 for one ASIAIR target: choose nights, then "Build final stack" (Siril on the processor) or
	 * "Download for processing" (a tar of the raw lights, calibration, masters and the latest final).
	 */
	let { target, nights, finals }: { target: string; nights: string[]; finals: FinalsData } = $props();

	/** Nights left out (all are in by default). */
	let unchecked = $state<Record<string, boolean>>({});
	let rejected = $state(false);
	let queued = $state(false);

	const chosen = $derived(nights.filter((n) => !unchecked[n]));
	/** All nights chosen: let the processor take every night (also ones archived after this page loaded). */
	const sent = $derived(chosen.length === nights.length ? [] : chosen);
	const pending = $derived(finals.list.find((f) => f.target === target && (f.status === 'queued' || f.status === 'running')));

	async function build() {
		queued = await finals.build(target, sent);
	}
</script>

<div class="actions">
	{#if nights.length > 1}
		<fieldset>
			<legend class="muted">Nights</legend>
			{#each nights as n (n)}
				<label class="night"><input type="checkbox" checked={!unchecked[n]} onchange={(e) => (unchecked = { ...unchecked, [n]: !e.currentTarget.checked })} />{nightLabel(n)}</label>
			{/each}
		</fieldset>
	{:else if nights.length === 1}
		<span class="muted small">{nightLabel(nights[0])}</span>
	{/if}
	<div class="buttons">
		<button class="btn primary" disabled={finals.busy || chosen.length === 0} onclick={build} title={pending?.status === 'queued' ? 'Replaces the queued one' : undefined}>Build final stack</button>
		<a class="btn" class:disabled={chosen.length === 0} href={chosen.length ? downloadUrl(target, sent, rejected) : undefined} download>Download for processing</a>
		<label class="small muted"><input type="checkbox" bind:checked={rejected} />with rejected frames</label>
	</div>
	{#if queued && pending}<p class="small muted">Queued: {pending.status === 'running' ? (pending.progress ?? 'running') : 'waiting for its turn'}.</p>{/if}
	{#if pending?.status === 'queued' && !queued}<p class="small muted">A final of {target} is already queued; building again replaces it.</p>{/if}
</div>

<style>
	.actions {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	fieldset {
		margin: 0;
		padding: 0;
		border: 0;
		display: flex;
		flex-wrap: wrap;
		gap: 4px 12px;
		font-size: 13px;
	}
	legend {
		padding: 0 0 4px;
		font-size: 12px;
	}
	.night,
	.buttons label {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		cursor: pointer;
	}
	input[type='checkbox'] {
		accent-color: var(--accent);
		margin: 0;
	}
	.buttons {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px;
	}
	.btn.disabled {
		opacity: 0.55;
		pointer-events: none;
	}
	.small {
		font-size: 13px;
	}
	p {
		margin: 0;
	}
</style>
