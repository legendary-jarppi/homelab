<script lang="ts">
	import { niceMax } from '$lib/format';
	import type { Point } from '$lib/types';

	interface ChartSeries {
		id: string;
		points: Point[];
		color: string;
	}

	let {
		series,
		height = 140,
		/** Formats y-axis labels; omit for a bare sparkline. */
		label,
		/** Smallest y-axis maximum, so a quiet line doesn't fill the chart. */
		minMax = 1,
		/** Fixed y maximum (e.g. 1 for ratios); overrides auto-scaling. */
		fixedMax
	}: {
		series: ChartSeries[];
		height?: number;
		label?: (value: number) => string;
		minMax?: number;
		fixedMax?: number;
	} = $props();

	let width = $state(0);
	const PAD_TOP = 8;
	const PAD_BOTTOM = 4;

	const all = $derived(series.flatMap((s) => s.points));
	const t0 = $derived(Math.min(...all.map((p) => p[0])));
	const t1 = $derived(Math.max(...all.map((p) => p[0])));
	const yMax = $derived(fixedMax ?? niceMax(Math.max(minMax, ...all.map((p) => p[1]))));

	function geometry(points: Point[]) {
		if (points.length < 2 || width === 0 || t1 <= t0) return null;
		const plotH = height - PAD_TOP - PAD_BOTTOM;
		const xy = points.map(([t, v]) => [((t - t0) / (t1 - t0)) * width, PAD_TOP + plotH - (Math.min(v, yMax) / yMax) * plotH]);
		// Horizontal-tangent cubic segments: smooth, and never overshoot between samples.
		let line = `M${xy[0][0]},${xy[0][1]}`;
		for (let i = 1; i < xy.length; i++) {
			const [x0, y0] = xy[i - 1];
			const [x1, y1] = xy[i];
			const mx = (x0 + x1) / 2;
			line += ` C${mx},${y0} ${mx},${y1} ${x1},${y1}`;
		}
		const last = xy[xy.length - 1];
		return { line, area: `${line} L${last[0]},${height} L${xy[0][0]},${height} Z`, last };
	}
</script>

<div class="chart" bind:clientWidth={width} style:height="{height}px">
	<svg {width} {height} aria-hidden="true">
		<defs>
			{#each series as s (s.id)}
				<linearGradient id="fill-{s.id}" x1="0" x2="0" y1="0" y2="1">
					<stop offset="0%" stop-color={s.color} stop-opacity="0.35" />
					<stop offset="100%" stop-color={s.color} stop-opacity="0" />
				</linearGradient>
			{/each}
		</defs>
		{#each [0.5, 1] as f (f)}
			<line class="grid" x1="0" x2={width} y1={PAD_TOP + (height - PAD_TOP - PAD_BOTTOM) * (1 - f)} y2={PAD_TOP + (height - PAD_TOP - PAD_BOTTOM) * (1 - f)} />
		{/each}
		{#each series as s (s.id)}
			{@const g = geometry(s.points)}
			{#if g}
				<path d={g.area} fill="url(#fill-{s.id})" />
				<path d={g.line} fill="none" stroke={s.color} stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />
				<circle cx={g.last[0]} cy={g.last[1]} r="3.5" fill={s.color} class="dot" style:color={s.color} />
			{/if}
		{/each}
	</svg>
	{#if label}
		<span class="axis top num">{label(yMax)}</span>
		<span class="axis mid num">{label(yMax / 2)}</span>
	{/if}
</div>

<style>
	.chart {
		position: relative;
		width: 100%;
	}
	svg {
		display: block;
		overflow: visible;
	}
	.grid {
		stroke: rgba(255, 255, 255, 0.06);
		stroke-dasharray: 3 5;
	}
	.dot {
		filter: drop-shadow(0 0 6px currentColor);
	}
	.axis {
		position: absolute;
		right: 0;
		font-size: 11px;
		color: var(--faint);
		transform: translateY(-110%);
	}
	.axis.top {
		top: 8px;
	}
	.axis.mid {
		top: calc(8px + (100% - 12px) / 2);
	}
</style>
