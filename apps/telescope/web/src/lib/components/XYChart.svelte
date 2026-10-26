<script lang="ts" module>
	export interface XYSeries {
		/** [x, y]; for lines in drawing order, null y breaks the line. */
		points: [number, number | null][];
		/** CSS colour, a var(--…). */
		color: string;
		kind?: 'line' | 'dots';
		dash?: string;
		width?: number;
		radius?: number;
		opacity?: number;
		/** Tooltip per point (dots). */
		title?: (i: number) => string;
	}
</script>

<script lang="ts">
	/**
	 * A numeric x/y panel (SVG) for what is not over time: focus position against temperature, V-curves (star size
	 * against focuser position), periodograms. Dots or lines, vertical marker lines, three ticks per axis.
	 */
	let {
		series,
		height = 180,
		xMin,
		xMax,
		yMin,
		yMax,
		xFormat = (v: number) => String(Math.round(v)),
		yFormat = (v: number) => v.toFixed(1),
		xLabel,
		yLabel,
		vlines = [],
		label
	}: {
		series: XYSeries[];
		height?: number;
		xMin?: number;
		xMax?: number;
		yMin?: number;
		yMax?: number;
		xFormat?: (v: number) => string;
		yFormat?: (v: number) => string;
		xLabel?: string;
		yLabel?: string;
		vlines?: { x: number; color?: string; label?: string; dash?: boolean }[];
		label: string;
	} = $props();

	const LEFT = 42;
	const RIGHT = 8;
	const AXIS_H = 30;
	let width = $state(0);
	const plotH = $derived(height - AXIS_H);

	const range = $derived.by(() => {
		const pts = series.flatMap((s) => s.points.filter((p): p is [number, number] => p[1] !== null));
		const xs = [...pts.map((p) => p[0]), ...vlines.map((v) => v.x)];
		const ys = pts.map((p) => p[1]);
		let x0 = xMin ?? (xs.length ? Math.min(...xs) : 0);
		let x1 = xMax ?? (xs.length ? Math.max(...xs) : 1);
		let y0 = yMin ?? (ys.length ? Math.min(...ys) : 0);
		let y1 = yMax ?? (ys.length ? Math.max(...ys) : 1);
		if (x1 - x0 < 1e-9) [x0, x1] = [x0 - 1, x1 + 1];
		if (y1 - y0 < 1e-9) [y0, y1] = [y0 - 1, y1 + 1];
		const px = (x1 - x0) * 0.04;
		const py = (y1 - y0) * 0.08;
		return { x0: xMin ?? x0 - px, x1: xMax ?? x1 + px, y0: yMin ?? y0 - py, y1: yMax ?? y1 + py };
	});
	const x = (v: number) => LEFT + ((v - range.x0) / (range.x1 - range.x0)) * (width - LEFT - RIGHT);
	/** The y-axis label sits above the plot. */
	const top = $derived(yLabel ? 16 : 4);
	const y = (v: number) => top + (1 - (v - range.y0) / (range.y1 - range.y0)) * (plotH - top - 4);
	const xTicks = $derived([range.x0, (range.x0 + range.x1) / 2, range.x1]);
	const yTicks = $derived([range.y1, (range.y0 + range.y1) / 2, range.y0]);

	function path(s: XYSeries): string {
		let d = '';
		let open = false;
		for (const [px, py] of s.points) {
			if (py === null) {
				open = false;
				continue;
			}
			d += `${open ? 'L' : 'M'}${x(px).toFixed(1)},${y(py).toFixed(1)}`;
			open = true;
		}
		return d;
	}
</script>

<div class="chart" bind:clientWidth={width} style:height="{height}px">
	{#if width > LEFT + RIGHT}
		<svg {width} {height} role="img" aria-label={label}>
			{#each yTicks as v, i (i)}
				<line class="grid" x1={LEFT} x2={width - RIGHT} y1={y(v)} y2={y(v)} />
				<text class="lab" x={LEFT - 5} y={y(v)} dy="0.35em" text-anchor="end">{yFormat(v)}</text>
			{/each}
			{#each xTicks as v, i (i)}
				<line class="tick" x1={x(v)} x2={x(v)} y1={plotH} y2={plotH + 3} />
				<text class="lab" x={x(v)} y={plotH + 13} text-anchor={i === 0 ? 'start' : i === 2 ? 'end' : 'middle'}>{xFormat(v)}</text>
			{/each}
			{#if xLabel}<text class="axis" x={LEFT + (width - LEFT - RIGHT) / 2} y={height - 2} text-anchor="middle">{xLabel}</text>{/if}
			{#if yLabel}<text class="axis" x={2} y={9}>{yLabel}</text>{/if}
			{#each vlines as v, i (i)}
				{#if v.x >= range.x0 && v.x <= range.x1}
					<line x1={x(v.x)} x2={x(v.x)} y1="0" y2={plotH} stroke={v.color ?? 'var(--faint)'} stroke-dasharray={v.dash ? '3 3' : undefined} stroke-width="1" />
					{#if v.label}<text class="vlab" x={x(v.x) + 3} y={20 + (i % 3) * 11} fill={v.color ?? 'var(--muted)'}>{v.label}</text>{/if}
				{/if}
			{/each}
			{#each series as s, i (i)}
				{#if s.kind === 'dots'}
					{#each s.points as [px, py], j (j)}
						{#if py !== null}
							<circle cx={x(px)} cy={y(py)} r={s.radius ?? 2.6} fill={s.color} fill-opacity={s.opacity ?? 1}>
								{#if s.title}<title>{s.title(j)}</title>{/if}
							</circle>
						{/if}
					{/each}
				{:else}
					<path d={path(s)} stroke={s.color} stroke-width={s.width ?? 1.5} stroke-dasharray={s.dash} stroke-opacity={s.opacity ?? 1} fill="none" stroke-linejoin="round" />
				{/if}
			{/each}
		</svg>
	{/if}
</div>

<style>
	.chart {
		position: relative;
		min-width: 0;
		width: 100%;
	}
	svg {
		display: block;
		overflow: visible;
	}
	text {
		font-size: 10px;
		font-variant-numeric: tabular-nums;
	}
	.lab,
	.axis {
		fill: var(--faint);
	}
	.vlab {
		font-size: 9.5px;
	}
	.grid {
		stroke: var(--border);
		stroke-width: 1;
		stroke-dasharray: 3 4;
	}
	.tick {
		stroke: var(--faint);
	}
</style>
