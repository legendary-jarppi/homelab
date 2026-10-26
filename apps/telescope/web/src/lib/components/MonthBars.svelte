<script lang="ts">
	import { monthLabel } from '$lib/stats';

	/** Stacked bars per month (SVG): one bar per month, the stacks bottom up, a three-tick value axis. */
	let {
		months,
		stacks,
		height = 150,
		format = (v: number) => String(Math.round(v)),
		label
	}: {
		/** "YYYY-MM", oldest first. */
		months: string[];
		/** Bottom up; `values` aligned with `months`. */
		stacks: { label: string; color: string; values: number[] }[];
		height?: number;
		format?: (v: number) => string;
		label: string;
	} = $props();

	const LEFT = 34;
	const AXIS_H = 18;
	let width = $state(0);
	const plotH = $derived(height - AXIS_H);
	const totals = $derived(months.map((_, i) => stacks.reduce((sum, s) => sum + (s.values[i] ?? 0), 0)));
	const top = $derived(Math.max(1, ...totals) * 1.08);
	const slot = $derived((width - LEFT) / Math.max(1, months.length));
	const y = (v: number) => plotH - (v / top) * (plotH - 6);
	/** Month labels: every month when there is room, else every 2nd, 3rd … ; the year at January and at the first. */
	const every = $derived(Math.max(1, Math.ceil(34 / Math.max(1, slot))));
</script>

<div class="chart" bind:clientWidth={width} style:height="{height}px">
	{#if width > LEFT}
		<svg {width} {height} role="img" aria-label={label}>
			{#each [top / 1.08, top / 2.16, 0] as v, i (i)}
				<line class="grid" x1={LEFT} x2={width} y1={y(v)} y2={y(v)} />
				<text class="lab" x={LEFT - 5} y={y(v)} dy="0.35em" text-anchor="end">{format(v)}</text>
			{/each}
			{#each months as month, i (month)}
				{@const x = LEFT + i * slot + slot * 0.15}
				{@const w = Math.max(1, slot * 0.7)}
				{#each stacks as s, k (k)}
					{@const below = stacks.slice(0, k).reduce((sum, b) => sum + (b.values[i] ?? 0), 0)}
					{#if (s.values[i] ?? 0) > 0}
						<rect {x} y={y(below + s.values[i])} width={w} height={Math.max(0.5, y(below) - y(below + s.values[i]))} fill={s.color} rx="2">
							<title>{monthLabel(month)} · {s.label}: {format(s.values[i])}</title>
						</rect>
					{/if}
				{/each}
				{#if i % every === 0}
					<text class="lab" x={LEFT + i * slot + slot / 2} y={height - 4} text-anchor="middle">{monthLabel(month, i === 0 || month.endsWith('-01'))}</text>
				{/if}
			{/each}
		</svg>
	{/if}
</div>
<div class="legend">
	{#each stacks as s (s.label)}
		<span><i style:background={s.color}></i>{s.label}</span>
	{/each}
</div>

<style>
	.chart {
		position: relative;
		width: 100%;
		min-width: 0;
	}
	svg {
		display: block;
		overflow: visible;
	}
	.lab {
		font-size: 10px;
		fill: var(--faint);
		font-variant-numeric: tabular-nums;
	}
	.grid {
		stroke: var(--border);
		stroke-dasharray: 3 4;
	}
	.legend {
		display: flex;
		flex-wrap: wrap;
		gap: 4px 14px;
		font-size: 12px;
		color: var(--muted);
	}
	.legend i {
		display: inline-block;
		width: 10px;
		height: 10px;
		border-radius: 2px;
		margin-right: 5px;
		vertical-align: -1px;
	}
</style>
