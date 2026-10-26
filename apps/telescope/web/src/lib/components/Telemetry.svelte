<script lang="ts">
	import Card from './Card.svelte';
	import TimeChart from './TimeChart.svelte';
	import { fixed, formatBytes } from '$lib/format';
	import type { Live, Storage, Telemetry } from '$lib/types';

	/**
	 * A8: the camera sensor against its set point, cooler power, the ASIAIR's board temperature, under-voltage and
	 * over-temperature, its Wi-Fi signal (over the session, and now from the live state), and free space on its storage.
	 */
	let { telemetry, live = null, storage = null }: { telemetry: Telemetry | null; live?: Live | null; storage?: Storage[] | null } = $props();

	const series = $derived(telemetry ? [telemetry.sensorTempC, telemetry.coolerPowerPct, telemetry.boardTempC, telemetry.wifiDbm] : []);
	const has = $derived(series.some((s) => s.length > 1));
	const from = $derived(Math.min(...series.map((s) => s[0]?.[0] ?? Infinity)));
	const to = $derived(Math.max(...series.map((s) => s.at(-1)?.[0] ?? -Infinity)));
	const last = (s: [number, number][] | undefined) => s?.at(-1)?.[1] ?? null;
	const sensor = $derived(live?.sensorTempC ?? last(telemetry?.sensorTempC));
	const cooler = $derived(live?.coolerPowerPct ?? last(telemetry?.coolerPowerPct));
	const board = $derived(live?.controllerTempC ?? last(telemetry?.boardTempC));
	const wifi = $derived(live?.wifiDbm ?? last(telemetry?.wifiDbm));
	const setPoint = $derived(telemetry?.setTempC ?? null);
	/** Sensor more than 1 °C off its set point: not cooled down yet, or the cooler cannot keep up. */
	const offSet = $derived(sensor !== null && setPoint !== null && Math.abs(sensor - setPoint) > 1);
</script>

<Card title="Telemetry">
	{#snippet accessory()}
		{#if live}
			{#if live.underVoltage}<span class="alarm">Under-voltage</span>{:else if live.underVoltage === false}<span class="ok">Power OK</span>{/if}
			{#if live.overTemp}<span class="alarm">Over temperature</span>{/if}
		{/if}
	{/snippet}
	<dl class="now">
		<div><dt>Sensor</dt><dd class="num" class:warn={offSet}>{fixed(sensor, 1)} °C{#if setPoint !== null}<small> / set {fixed(setPoint, 0)}</small>{/if}</dd></div>
		<div><dt>Cooler</dt><dd class="num">{fixed(cooler)} %</dd></div>
		<div><dt>ASIAIR board</dt><dd class="num">{fixed(board, 0)} °C</dd></div>
		<div><dt>Wi-Fi</dt><dd class="num">{fixed(wifi)} dBm</dd></div>
	</dl>
	{#if has && to > from}
		<div class="panels">
			<span class="plabel">Sensor °C (solid) and set point (dashed)</span>
			<TimeChart
				{from}
				{to}
				height={64}
				axis={false}
				series={[{ points: telemetry!.sensorTempC, color: 'var(--line1)' }]}
				hlines={setPoint !== null ? [{ y: setPoint, color: 'var(--muted)', dash: true }] : []}
				gapS={900}
				label="Sensor temperature"
			/>
			<span class="plabel">Cooler power %</span>
			<TimeChart {from} {to} height={54} axis={false} yMin={0} yMax={100} series={[{ points: telemetry!.coolerPowerPct, color: 'var(--line2)' }]} gapS={900} label="Cooler power" />
			<span class="plabel">ASIAIR board °C</span>
			<TimeChart {from} {to} height={54} axis={false} series={[{ points: telemetry!.boardTempC, color: 'var(--line4)' }]} gapS={900} label="Board temperature" />
			<span class="plabel">Wi-Fi dBm</span>
			<TimeChart {from} {to} height={70} series={[{ points: telemetry!.wifiDbm, color: 'var(--line3)' }]} gapS={900} label="Wi-Fi signal" />
		</div>
	{:else}
		<p class="muted small">No telemetry recorded for this session{live ? ' yet' : ' (sessions before the web app have none)'}.</p>
	{/if}
	{#if storage?.length}
		<div class="storage">
			{#each storage as s (s.name)}
				{@const used = s.totalBytes && s.freeBytes !== null ? 1 - s.freeBytes / s.totalBytes : null}
				<div class="disk">
					<div class="dl"><span>{s.name}</span><span class="num" class:warn={used !== null && used > 0.9}>{formatBytes(s.freeBytes)} free of {formatBytes(s.totalBytes)}</span></div>
					{#if used !== null}<div class="bar" class:full={used > 0.9}><span style:width="{used * 100}%"></span></div>{/if}
				</div>
			{/each}
		</div>
	{/if}
</Card>

<style>
	p {
		margin: 0;
	}
	.small {
		font-size: 13px;
	}
	.alarm {
		color: var(--bad);
		font-weight: 700;
	}
	.ok {
		color: var(--ok);
	}
	.now {
		margin: 0;
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(110px, 1fr));
		gap: 8px 16px;
	}
	dt {
		font-size: 12px;
		color: var(--muted);
	}
	dd {
		margin: 2px 0 0;
		font-size: 17px;
		font-weight: 600;
	}
	dd small {
		font-size: 12px;
		color: var(--muted);
		font-weight: 500;
	}
	.panels {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.plabel {
		font-size: 11px;
		color: var(--faint);
		margin-top: 4px;
	}
	.storage {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.dl {
		display: flex;
		justify-content: space-between;
		gap: 10px;
		font-size: 13px;
	}
	.bar {
		margin-top: 4px;
		height: 6px;
		border-radius: 3px;
		background: var(--surface-strong);
		overflow: hidden;
	}
	.bar span {
		display: block;
		height: 100%;
		background: var(--accent);
	}
	.bar.full span {
		background: var(--warn);
	}
</style>
