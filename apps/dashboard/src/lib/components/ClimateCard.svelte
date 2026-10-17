<script lang="ts">
	import Card from './Card.svelte';
	import { clock, dayOf } from '$lib/dates';
	import { night } from '$lib/night.svelte';
	import type { ClimateData, ClimateEntry } from '$lib/types';

	/** `configured`: CLIMATE_URL is set; `climate` null until the first answer. `onchange` replaces it with the service's answer. */
	let { climate, configured, onchange }: { climate: ClimateData | null; configured: boolean; onchange: (next: ClimateData) => void } = $props();

	type Innova = NonNullable<ClimateData['innova']['state']>;
	const MODES: { id: NonNullable<Innova['mode']>; label: string }[] = [
		{ id: 'heat', label: 'Heat' },
		{ id: 'cool', label: 'Cool' },
		{ id: 'auto', label: 'Auto' },
		{ id: 'dry', label: 'Dry' },
		{ id: 'fan', label: 'Fan' }
	];
	const FANS: { id: NonNullable<Innova['fan']>; label: string }[] = [
		{ id: 'auto', label: 'Auto' },
		{ id: 'low', label: '1' },
		{ id: 'medium-low', label: '2' },
		{ id: 'medium', label: '3' },
		{ id: 'medium-high', label: '4' },
		{ id: 'high', label: '5' }
	];
	const PRIORITY: Record<string, string> = { off: 'Idle', 'hot water': 'Heating hot water', heating: 'Heating the house', cooling: 'Cooling', pool: 'Heating the pool' };

	let busy = $state<'nibe' | 'innova' | null>(null);
	let problem = $state<{ device: 'nibe' | 'innova'; text: string } | null>(null);

	const nibe = $derived(climate?.nibe.state ?? null);
	const innova = $derived(climate?.innova.state ?? null);
	const deg = (v: number | null | undefined, digits = 1) => (v === null || v === undefined ? '–' : `${v.toFixed(digits)}°`);

	/** "15:42", or "ti 6.10. 15:42" when not today: when the last good reading was taken. */
	function at(ms: number): string {
		const iso = new Date(ms).toISOString();
		return dayOf(iso) === dayOf(night.now.toISOString()) ? clock(ms) : `${dayOf(iso)} ${clock(ms)}`;
	}

	async function change(device: 'nibe' | 'innova', body: Record<string, unknown>) {
		if (!climate || busy) return;
		busy = device;
		problem = null;
		try {
			const response = await fetch(`/api/climate?device=${device}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
			const answer = (await response.json().catch(() => null)) as (ClimateEntry<unknown> & { message?: string }) | null;
			if (answer && 'ok' in answer) onchange({ ...climate, [device]: answer } as ClimateData);
			if (!response.ok) problem = { device, text: answer?.message ?? answer?.error ?? `Change failed (${response.status}).` };
		} catch (e) {
			problem = { device, text: (e as Error).message };
		} finally {
			busy = null;
		}
	}
</script>

{#snippet status(entry: ClimateEntry<unknown>)}
	{#if !entry.ok}
		<p class="warn small">{entry.updatedAt ? `No answer since ${at(entry.updatedAt)}` : 'No answer'}{entry.error ? `: ${entry.error}` : ''}</p>
	{/if}
{/snippet}

<Card title="Cabin climate">
	{#if !configured}
		<p class="muted">Climate not set up.</p>
	{:else if !climate}
		<p class="muted">Climate unavailable.</p>
	{:else}
		<div class="devices">
			<section class:stale={!climate.nibe.ok} aria-label="NIBE heat pump">
				<header>
					<h3>Heat pump <span class="muted">NIBE</span></h3>
					{#if nibe}<span class="doing">{nibe.alarm ? `Alarm ${nibe.alarm}` : nibe.defrosting ? 'Defrosting' : (PRIORITY[nibe.priority ?? ''] ?? nibe.priority ?? '')}</span>{/if}
				</header>
				{@render status(climate.nibe)}
				{#if nibe}
					<dl class="facts">
						<div><dt>Outdoors</dt><dd class="num big">{deg(nibe.outdoor)}</dd></div>
						<div><dt>Hot water</dt><dd class="num big">{deg(nibe.hotWaterTop)}</dd></div>
						<div><dt>Heating water</dt><dd class="num">{deg(nibe.supply)} <span class="muted">target {deg(nibe.calculatedSupply)}</span></dd></div>
						<div>
							<dt>Compressor</dt>
							<dd class="num">{nibe.compressorHz ? `${nibe.compressorHz.toFixed(0)} Hz` : 'Off'}{#if nibe.additionalHeatSteps}<span class="warn"> · electric heat {nibe.additionalHeatSteps}</span>{/if}</dd>
						</div>
					</dl>
					<div class="control">
						<span class="label">Heating offset</span>
						<div class="stepper">
							<button aria-label="Lower the heating" disabled={busy !== null || nibe.offset === null || nibe.offset <= -10} onclick={() => change('nibe', { offset: (nibe.offset ?? 0) - 1 })}>−</button>
							<span class="num value">{nibe.offset === null ? '–' : nibe.offset > 0 ? `+${nibe.offset}` : nibe.offset}</span>
							<button aria-label="Raise the heating" disabled={busy !== null || nibe.offset === null || nibe.offset >= 10} onclick={() => change('nibe', { offset: (nibe.offset ?? 0) + 1 })}>+</button>
						</div>
					</div>
					<div class="control">
						<span class="label">Hot water amount</span>
						<div class="segmented" role="radiogroup" aria-label="Hot water amount">
							{#each Object.entries(climate.hotWaterDemands) as [value, label] (value)}
								<button role="radio" aria-checked={nibe.hotWaterDemand === Number(value)} class:active={nibe.hotWaterDemand === Number(value)} disabled={busy !== null} onclick={() => change('nibe', { hotWaterDemand: Number(value) })}>{label}</button>
							{/each}
						</div>
					</div>
				{/if}
				{#if problem?.device === 'nibe'}<p class="error small">{problem.text}</p>{/if}
			</section>

			<section class:stale={!climate.innova.ok} aria-label="Innova air heat pump">
				<header>
					<h3>Air heat pump <span class="muted">Innova</span></h3>
					{#if innova}
						<button class="power" class:on={innova.power} disabled={busy !== null} onclick={() => change('innova', { power: !innova.power })} aria-pressed={innova.power}>
							{innova.power ? 'On' : 'Off'}
						</button>
					{/if}
				</header>
				{@render status(climate.innova)}
				{#if innova}
					<dl class="facts">
						<div><dt>Room</dt><dd class="num big">{deg(innova.room, 0)}</dd></div>
						<div><dt>Now</dt><dd class="big">{innova.power ? (MODES.find((m) => m.id === innova.mode)?.label ?? '–') : 'Off'}</dd></div>
					</dl>
					<div class="control">
						<span class="label">Target</span>
						<div class="stepper">
							<button aria-label="Lower the target" disabled={busy !== null || innova.target === null || innova.target <= 16} onclick={() => change('innova', { target: (innova.target ?? 22) - 1 })}>−</button>
							<span class="num value">{deg(innova.target, 0)}</span>
							<button aria-label="Raise the target" disabled={busy !== null || innova.target === null || innova.target >= 30} onclick={() => change('innova', { target: (innova.target ?? 22) + 1 })}>+</button>
						</div>
					</div>
					<div class="control">
						<span class="label">Mode</span>
						<div class="segmented" role="radiogroup" aria-label="Mode">
							{#each MODES as m (m.id)}
								<button role="radio" aria-checked={innova.mode === m.id} class:active={innova.mode === m.id} disabled={busy !== null} onclick={() => change('innova', { mode: m.id })}>{m.label}</button>
							{/each}
						</div>
					</div>
					<div class="control">
						<span class="label">Fan</span>
						<div class="segmented" role="radiogroup" aria-label="Fan speed">
							{#each FANS as f (f.id)}
								<button role="radio" aria-checked={innova.fan === f.id} class:active={innova.fan === f.id} disabled={busy !== null} onclick={() => change('innova', { fan: f.id })}>{f.label}</button>
							{/each}
						</div>
					</div>
				{/if}
				{#if problem?.device === 'innova'}<p class="error small">{problem.text}</p>{/if}
			</section>
		</div>
	{/if}
</Card>

<style>
	p {
		margin: 0;
		font-size: 14px;
	}
	.small {
		font-size: 13px;
	}
	.warn {
		color: var(--warn);
	}
	.error {
		color: var(--bad);
	}
	.devices {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
		gap: 18px 28px;
	}
	section {
		display: grid;
		align-content: start;
		gap: 12px;
		min-width: 0;
	}
	section.stale :is(.facts, .control) {
		opacity: 0.55;
	}
	header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
	}
	h3 {
		margin: 0;
		font-size: 17px;
		font-weight: 650;
	}
	h3 .muted {
		font-weight: 500;
		font-size: 14px;
	}
	.doing {
		font-size: 13px;
		font-weight: 600;
		color: var(--ok);
	}
	.facts {
		margin: 0;
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 10px 16px;
	}
	dt {
		font-size: 12px;
		color: var(--muted);
	}
	dd {
		margin: 2px 0 0;
		font-size: 15px;
		font-weight: 550;
	}
	dd.big {
		font-size: 26px;
		font-weight: 650;
		letter-spacing: -0.02em;
	}
	.control {
		display: grid;
		gap: 6px;
	}
	.label {
		font-size: 12px;
		color: var(--muted);
	}
	.stepper {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		justify-self: start;
		padding: 4px;
		border-radius: 14px;
		background: rgba(255, 255, 255, 0.06);
	}
	.stepper button {
		width: 44px;
		height: 40px;
		font-size: 20px;
		font-weight: 600;
		color: var(--text);
		border: 0;
		border-radius: 10px;
		background: rgba(255, 255, 255, 0.08);
		cursor: pointer;
	}
	.stepper .value {
		min-width: 52px;
		text-align: center;
		font-size: 17px;
		font-weight: 650;
	}
	.segmented {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
		padding: 4px;
		border-radius: 14px;
		background: rgba(255, 255, 255, 0.06);
	}
	.segmented button {
		flex: 1;
		min-width: 44px;
		padding: 9px 8px;
		font-size: 14px;
		font-weight: 600;
		text-transform: capitalize;
		color: var(--muted);
		border: 0;
		border-radius: 10px;
		background: transparent;
		cursor: pointer;
	}
	.segmented button.active {
		color: var(--text);
		background: rgba(255, 255, 255, 0.16);
	}
	.power {
		min-width: 64px;
		padding: 7px 14px;
		font-size: 14px;
		font-weight: 700;
		color: var(--muted);
		border: 1px solid var(--border);
		border-radius: 999px;
		background: var(--surface-strong);
		cursor: pointer;
	}
	.power.on {
		color: #04121c;
		background: var(--ok);
		border-color: transparent;
	}
	button:disabled {
		opacity: 0.5;
		cursor: wait;
	}
</style>
