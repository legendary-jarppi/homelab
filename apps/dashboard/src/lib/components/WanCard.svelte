<script lang="ts">
	import AreaChart from './AreaChart.svelte';
	import Card from './Card.svelte';
	import { formatBits, formatBytes } from '$lib/format';
	import type { LiveData } from '$lib/types';

	let { wan }: { wan: LiveData['wan'] } = $props();

	const down = $derived(formatBits(wan.downNow));
	const up = $derived(formatBits(wan.upNow));
	const axisLabel = (v: number) => {
		const f = formatBits(v);
		return `${f.value} ${f.unit}`;
	};
	/** The chart takes whatever height the card leaves. */
	let chartHeight = $state(0);
</script>

<Card title="Internet">
	{#snippet accessory()}
		{#if wan.latencyMs !== null}<span class="num">{wan.latencyMs < 1 ? '<1' : Math.round(wan.latencyMs)} ms latency</span>{/if}
	{/snippet}
	<div class="rates">
		<div class="rate">
			<span class="dir down">
				<svg viewBox="0 0 24 24"><path d="M12 4v16m0 0-6-6m6 6 6-6" /></svg>Download
			</span>
			<span class="value num">{down.value}<small>{down.unit}</small></span>
			<span class="total muted num">{formatBytes(wan.down24h)} in 24 h</span>
		</div>
		<div class="rate">
			<span class="dir up">
				<svg viewBox="0 0 24 24"><path d="M12 20V4m0 0-6 6m6-6 6 6" /></svg>Upload
			</span>
			<span class="value num">{up.value}<small>{up.unit}</small></span>
			<span class="total muted num">{formatBytes(wan.up24h)} in 24 h</span>
		</div>
	</div>
	<div class="chart" bind:clientHeight={chartHeight}>
		{#if chartHeight > 0}
			<AreaChart
				height={Math.max(56, chartHeight - 22)}
				minMax={2e6}
				label={axisLabel}
				series={[
					{ id: 'wan-down', points: wan.down, color: 'var(--down)' },
					{ id: 'wan-up', points: wan.up, color: 'var(--up)' }
				]}
			/>
		{/if}
		<div class="axis muted"><span>15 min ago</span><span>now</span></div>
	</div>
</Card>

<style>
	.rates {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 16px;
	}
	.rate {
		display: grid;
		gap: 1px;
	}
	.dir {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-size: 13px;
		font-weight: 600;
	}
	.dir svg {
		width: 15px;
		height: 15px;
		fill: none;
		stroke: currentColor;
		stroke-width: 2.5;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
	.dir.down {
		color: var(--down);
	}
	.dir.up {
		color: var(--up);
	}
	.value {
		font-size: clamp(30px, 3.2vw, 46px);
		font-weight: 650;
		line-height: 1.05;
	}
	.value small {
		margin-left: 6px;
		font-size: 0.4em;
		font-weight: 500;
		color: var(--muted);
	}
	.total {
		font-size: 12px;
	}
	.chart {
		flex: 1;
		min-height: 64px;
		display: flex;
		flex-direction: column;
		justify-content: flex-end;
	}
	.axis {
		display: flex;
		justify-content: space-between;
		margin-top: 4px;
		font-size: 11px;
	}
</style>
