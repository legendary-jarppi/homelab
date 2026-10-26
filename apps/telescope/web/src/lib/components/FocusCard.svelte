<script lang="ts">
	import Card from './Card.svelte';
	import TimeChart, { type ChartMark, type ChartSeries } from './TimeChart.svelte';
	import XYChart from './XYChart.svelte';
	import { RUUVI_SINCE, vCurveSeries } from '$lib/focus';
	import { clock, fixed } from '$lib/format';
	import type { AutofocusRun, GuideLogSummary, SessionDetail, SessionTemperatures } from '$lib/types';

	/**
	 * A5: the session's focus: frames' HFR and focuser position with the auto focus runs marked (a click shows the
	 * run's V-curve), the temperature (the runs' focuser readings, the cabin's outdoor RuuviTag, Open-Meteo at the
	 * site), and a link to the night's PHD2 guide log analysis (D7).
	 */
	let { session }: { session: SessionDetail } = $props();

	const runs = $derived(session.autofocus ?? []);
	const frames = $derived(session.frames.filter((f) => f.hfr !== null || (f.focusPos ?? null) !== null));
	const from = $derived(Math.min(session.firstFrameAt, ...runs.map((r) => r.at)) - 300);
	const to = $derived(Math.max(session.lastFrameAt, ...runs.map((r) => r.endedAt ?? r.at)) + 300);

	let selectedAt = $state<number | null>(null);
	const selected = $derived<AutofocusRun | null>(runs.find((r) => r.at === selectedAt && r.points.length) ?? null);
	const marks = $derived<ChartMark[]>(runs.map((r) => ({ at: r.at, color: r.success === false ? 'var(--bad)' : 'var(--accent)', dash: r.source === 'live' })));

	const hfr = $derived<ChartSeries[]>([
		{ points: frames.filter((f) => f.accepted).map((f) => [f.at, f.hfr]), color: 'var(--line1)', kind: 'dots' },
		{ points: frames.filter((f) => !f.accepted).map((f) => [f.at, f.hfr]), color: 'var(--faint)', kind: 'dots' }
	]);
	const positions = $derived(frames.filter((f) => (f.focusPos ?? null) !== null).map((f) => [f.at, f.focusPos!] as [number, number]));
	const focusSeries = $derived<ChartSeries[]>([
		{ points: positions, color: 'var(--line2)', kind: 'step' },
		{ points: runs.filter((r) => r.position !== null).map((r) => [r.endedAt ?? r.at, r.position]), color: 'var(--ok)', kind: 'dots', radius: () => 3.2 }
	]);

	let temps = $state<SessionTemperatures | null>(null);
	let tempsError = $state<string | null>(null);
	let guideLog = $state<GuideLogSummary | null>(null);
	$effect(() => {
		const url = `/api/temperature?from=${Math.floor(from)}&to=${Math.ceil(to)}`;
		let gone = false;
		fetch(url)
			.then((r) => (r.ok ? (r.json() as Promise<SessionTemperatures>) : Promise.reject(new Error(`HTTP ${r.status}`))))
			.then((body) => !gone && ((temps = body), (tempsError = null)))
			.catch((e: Error) => !gone && (tempsError = e.message));
		return () => (gone = true);
	});
	$effect(() => {
		const night = session.night;
		let gone = false;
		fetch('/api/guidelogs')
			.then((r) => (r.ok ? (r.json() as Promise<GuideLogSummary[]>) : []))
			.then((logs) => !gone && (guideLog = logs.find((g) => g.night === night) ?? null))
			.catch(() => {});
		return () => (gone = true);
	});
	const afTemps = $derived(runs.filter((r) => r.temperatureC !== null).map((r) => [r.at, r.temperatureC] as [number, number]));
	const tempSeries = $derived<ChartSeries[]>([
		{ points: temps?.openMeteo.data ?? [], color: 'var(--line3)', dash: '4 3' },
		{ points: temps?.ruuvi.data ?? [], color: 'var(--line4)' },
		{ points: afTemps, color: 'var(--accent)', kind: 'dots', radius: () => 3.2 }
	]);
</script>

<Card title="Focus">
	{#snippet accessory()}
		{#if runs.length}<span class="num muted">{runs.length} auto focus run{runs.length === 1 ? '' : 's'}</span>{/if}
	{/snippet}
	{#if frames.length || runs.length}
		<div class="panels">
			<span class="plabel">HFR, px (accepted; grey rejected)</span>
			<TimeChart {from} {to} height={70} axis={false} series={hfr} {marks} label="HFR per frame" />
			{#if positions.length || runs.some((r) => r.position !== null)}
				<span class="plabel">Focuser position (line: frames; green: auto focus result)</span>
				<TimeChart {from} {to} height={70} axis={false} series={focusSeries} {marks} yFormat={(v) => v.toFixed(0)} label="Focuser position" />
			{/if}
			<span class="plabel">Temperature °C: <i class="key af"></i>focuser at each run, <i class="key ruuvi"></i>outdoor RuuviTag, <i class="key om"></i>Open-Meteo</span>
			<TimeChart {from} {to} height={80} series={tempSeries} {marks} gapS={5400} label="Temperature" />
			{#if runs.length}
				<div class="chips" aria-label="Auto focus runs">
					{#each runs as r (r.at)}
						<button
							type="button"
							style:left="calc(38px + (100% - 38px) * {((r.at - from) / Math.max(1, to - from)).toFixed(4)})"
							class:active={selected === r}
							class:failed={r.success === false}
							disabled={!r.points.length}
							title={r.points.length ? `${clock(r.at * 1000)}: ${r.reason ?? 'auto focus'}` : 'From the live history: the V-curve comes with the run\u2019s Autorun log'}
							onclick={() => (selectedAt = selectedAt === r.at ? null : r.at)}>{r.position ?? 'AF'}</button>
					{/each}
				</div>
			{/if}
		</div>
		{#if selected}
			<XYChart
				series={vCurveSeries(selected, 'var(--line1)')}
				height={170}
				xLabel="EAF position"
				yLabel="star size"
				vlines={selected.position !== null ? [{ x: selected.position, color: 'var(--ok)', label: `focus ${selected.position}` }] : []}
				label="V-curve"
			/>
			<p class="small">
				<strong>{clock(selected.at * 1000)}</strong> {selected.reason ?? ''}, {fixed(selected.temperatureC)} °C:
				{#if selected.success}focused at <span class="num">{selected.position}</span>, star size {fixed(selected.bestSize, 1)}{:else}failed{selected.failure ? ` (${selected.failure})` : ''}{/if}
			</p>
		{:else if runs.some((r) => r.points.length)}
			<p class="muted small">Click a run's label for its V-curve.</p>
		{/if}
		<p class="muted small">
			{#if !runs.length}No auto focus run in this session's window.{:else if runs.every((r) => r.source === 'live')}The auto focus runs come from the live history until the ASIAIR puts the run's Autorun log on its share (at the end of the run): times only.{/if}
			{#if !positions.length && frames.length}No focuser positions for these frames yet (FOCUSPOS: frames analysed before it was kept get theirs from the archived headers in the background).{/if}
			{#if tempsError}Temperatures unavailable: {tempsError}.{:else if temps}
				{#if temps.ruuvi.error}RuuviTag: {temps.ruuvi.error}.{:else if !temps.ruuvi.data?.length}No outdoor RuuviTag (Terassi) readings in this window: Prometheus has Ruuvi data from {RUUVI_SINCE} on, and only while the gateway hears the tag.{/if}
				{#if temps.openMeteo.error}Open-Meteo: {temps.openMeteo.error}.{/if}
			{/if}
		</p>
	{:else}
		<p class="muted small">No analysed frames yet.</p>
	{/if}
	{#if guideLog}
		<a class="small" href="/stats/mount?log={encodeURIComponent(guideLog.id)}">This night's PHD2 guide log: periodic error, drift, backlash →</a>
	{/if}
</Card>

<style>
	p {
		margin: 0;
	}
	.small {
		font-size: 13px;
	}
	.panels {
		position: relative;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.plabel {
		font-size: 11px;
		color: var(--faint);
		margin-top: 4px;
	}
	.key {
		display: inline-block;
		width: 12px;
		height: 0;
		border-top: 2px solid;
		margin: 0 3px 2px 6px;
		vertical-align: middle;
	}
	.key.af {
		width: 6px;
		height: 6px;
		border: none;
		border-radius: 50%;
		background: var(--accent);
	}
	.key.ruuvi {
		border-color: var(--line4);
	}
	.key.om {
		border-top-style: dashed;
		border-color: var(--line3);
	}
	.chips {
		position: relative;
		height: 22px;
	}
	.chips button {
		position: absolute;
		top: 2px;
		transform: translateX(-50%);
		font: inherit;
		font-size: 11px;
		font-variant-numeric: tabular-nums;
		padding: 1px 6px;
		border-radius: 999px;
		border: 1px solid var(--accent);
		background: var(--surface);
		color: var(--accent);
		cursor: pointer;
	}
	.chips button.active {
		background: var(--surface-strong);
		color: var(--text);
		font-weight: 700;
	}
	.chips button.failed {
		border-color: var(--bad);
		color: var(--bad);
	}
	.chips button:disabled {
		cursor: default;
		border-style: dashed;
	}
</style>
