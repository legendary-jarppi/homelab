<script lang="ts">
	import { monthLabel } from '$lib/stats';

	/** Values over months (SVG): a dot per point (a link when it has one), month ticks, a three-tick value axis (from 0, or around the values without `fromZero`). */
	let {
		series,
		height = 130,
		yFormat = (v: number) => v.toFixed(1),
		label,
		fromZero = true
	}: {
		/** `at` unix s. */
		series: { label: string; color: string; points: { at: number; value: number; title: string; href?: string }[] }[];
		height?: number;
		yFormat?: (v: number) => string;
		label: string;
		fromZero?: boolean;
	} = $props();

	const LEFT = 34;
	const AXIS_H = 18;
	let width = $state(0);
	const plotH = $derived(height - AXIS_H);
	const all = $derived(series.flatMap((s) => s.points));
	const range = $derived.by(() => {
		const times = all.map((p) => p.at);
		const values = all.map((p) => p.value);
		// Without `fromZero`: a tenth of the spread (at least 0.1) of room below and above.
		const pad = Math.max(0.1, (Math.max(...values) - Math.min(...values)) / 10);
		const lo = fromZero ? Math.min(0, ...values) : Math.min(...values) - pad;
		const top = fromZero ? Math.max(lo + 0.1, ...values) : Math.max(...values) + pad;
		// A week of margin on both sides so the first and last dots are not on the edge.
		return { from: Math.min(...times) - 7 * 86400, to: Math.max(...times) + 7 * 86400, lo, top, hi: fromZero ? top * 1.1 : top };
	});
	const x = (t: number) => LEFT + ((t - range.from) / Math.max(1, range.to - range.from)) * (width - LEFT - 6);
	const y = (v: number) => 4 + (1 - (v - range.lo) / (range.hi - range.lo)) * (plotH - 8);
	/** Month starts in range; every n-th labelled so labels stay ~40 px apart. */
	const ticks = $derived.by(() => {
		if (!all.length) return [];
		const out: { at: number; month: string }[] = [];
		const d = new Date(range.from * 1000);
		for (let m = new Date(d.getFullYear(), d.getMonth() + 1, 1); m.getTime() / 1000 <= range.to; m = new Date(m.getFullYear(), m.getMonth() + 1, 1))
			out.push({ at: m.getTime() / 1000, month: `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}` });
		return out;
	});
	const every = $derived(Math.max(1, Math.ceil((40 * ticks.length) / Math.max(1, width - LEFT))));
</script>

<div class="chart" bind:clientWidth={width} style:height="{height}px">
	{#if width > LEFT && all.length}
		<svg {width} {height} role="img" aria-label={label}>
			{#each [range.top, (range.top + range.lo) / 2, range.lo] as v, i (i)}
				<line class="grid" x1={LEFT} x2={width} y1={y(v)} y2={y(v)} />
				<text class="lab" x={LEFT - 5} y={y(v)} dy="0.35em" text-anchor="end">{yFormat(v)}</text>
			{/each}
			{#each ticks as t, i (t.at)}
				<line class="tick" x1={x(t.at)} x2={x(t.at)} y1={plotH} y2={plotH + 3} />
				{#if i % every === 0}<text class="lab" x={x(t.at)} y={height - 4} text-anchor="middle">{monthLabel(t.month, i === 0 || t.month.endsWith('-01'))}</text>{/if}
			{/each}
			{#each series as s (s.label)}
				{#each s.points as p, i (i)}
					{#if p.href}
						<a href={p.href}><circle cx={x(p.at)} cy={y(p.value)} r="4" fill={s.color}><title>{p.title}</title></circle></a>
					{:else}
						<circle cx={x(p.at)} cy={y(p.value)} r="4" fill={s.color}><title>{p.title}</title></circle>
					{/if}
				{/each}
			{/each}
		</svg>
	{/if}
</div>
<div class="legend">
	{#each series as s (s.label)}
		<span><i style:background={s.color}></i>{s.label} ({s.points.length})</span>
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
	.tick {
		stroke: var(--faint);
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
		border-radius: 50%;
		margin-right: 5px;
		vertical-align: -1px;
	}
</style>
