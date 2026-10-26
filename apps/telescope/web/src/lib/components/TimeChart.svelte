<script lang="ts" module>
	export interface ChartSeries {
		/** [unix s, value], oldest first; null values break the line. */
		points: [number, number | null][];
		/** CSS colour, usually a var(--…). */
		color: string;
		kind?: 'line' | 'dots' | 'step';
		dash?: string;
		width?: number;
		/** Dots: a radius per point (e.g. rejected frames bigger). */
		radius?: (i: number) => number;
	}
	export interface ChartMark {
		at: number;
		color?: string;
		label?: string;
		dash?: boolean;
	}
</script>

<script lang="ts">
	import { clock } from '$lib/format';

	/**
	 * One time-series panel (SVG): lines, steps or dots over [from, to] (unix s), with vertical marks (events),
	 * shaded bands (darkness, settling), horizontal reference lines and a local-time axis. Panels with the same
	 * from/to line up, so several stacked share one time axis.
	 */
	let {
		from,
		to,
		series,
		height = 90,
		yMin,
		yMax,
		yFormat,
		symmetric = false,
		marks = [],
		bands = [],
		hlines = [],
		axis = true,
		gapS = Infinity,
		label
	}: {
		from: number;
		to: number;
		series: ChartSeries[];
		height?: number;
		yMin?: number;
		yMax?: number;
		yFormat?: (v: number) => string;
		/** Scale around 0 (guiding errors). */
		symmetric?: boolean;
		marks?: ChartMark[];
		bands?: { from: number; to: number; fill: string }[];
		hlines?: { y: number; color?: string; label?: string; dash?: boolean }[];
		axis?: boolean;
		/** Break lines across gaps longer than this, seconds. */
		gapS?: number;
		label?: string;
	} = $props();

	const LEFT = 38;
	const clipId = $props.id();
	const AXIS_H = 16;
	let width = $state(0);
	const plotH = $derived(height - (axis ? AXIS_H : 0));

	const range = $derived.by(() => {
		const values = series.flatMap((s) => s.points.filter(([t, v]) => v !== null && t >= from && t <= to).map(([, v]) => v as number));
		values.push(...hlines.map((h) => h.y));
		let lo = yMin ?? (values.length ? Math.min(...values) : 0);
		let hi = yMax ?? (values.length ? Math.max(...values) : 1);
		if (symmetric) {
			hi = Math.max(Math.abs(lo), Math.abs(hi), yMax ?? 0);
			lo = -hi;
		}
		if (hi - lo < 1e-9) {
			hi += 1;
			lo -= yMin === undefined ? 1 : 0;
		} else if (!symmetric) {
			const pad = (hi - lo) * 0.08;
			if (yMax === undefined) hi += pad;
			if (yMin === undefined) lo -= pad;
		}
		return { lo, hi };
	});
	const x = (t: number) => LEFT + ((t - from) / Math.max(1, to - from)) * (width - LEFT);
	const y = (v: number) => 4 + (1 - (v - range.lo) / (range.hi - range.lo)) * (plotH - 8);
	/** Labels with enough decimals to tell the ticks apart (a flat −20 °C sensor read "-20, -20, -20"). */
	const format = $derived.by(() => {
		if (yFormat) return yFormat;
		const span = range.hi - range.lo;
		const decimals = span >= 10 ? 0 : span >= 1 ? 1 : 2;
		return (v: number) => (Object.is(Math.round(v * 10 ** decimals), -0) ? 0 : v).toFixed(decimals);
	});

	function path(s: ChartSeries): string {
		let d = '';
		let prev: [number, number] | null = null;
		for (const [t, v] of s.points) {
			if (v === null || t < from - gapS || t > to + gapS) {
				prev = null;
				continue;
			}
			const px = x(t).toFixed(1);
			const py = y(v).toFixed(1);
			if (!prev || t - prev[0] > gapS) d += `M${px},${py}`;
			else if (s.kind === 'step') d += `H${px}V${py}`;
			else d += `L${px},${py}`;
			prev = [t, v];
		}
		return d;
	}

	/** Tick step: the smallest that keeps labels about 64 px apart. */
	const ticks = $derived.by(() => {
		if (width <= LEFT) return [];
		const steps = [900, 1800, 3600, 7200, 10800, 21600, 43200, 86400];
		const want = (to - from) / Math.max(1, (width - LEFT) / 64);
		const step = steps.find((s) => s >= want) ?? 86400;
		// Align to the local hour grid (the zone offset is whole quarter hours).
		const offset = -new Date(from * 1000).getTimezoneOffset() * 60;
		const out: number[] = [];
		for (let t = Math.ceil((from + offset) / step) * step - offset; t <= to; t += step) out.push(t);
		return out;
	});
	/** Mark labels closer than ~50 px to the previous one go one row down. */
	const labelRow = $derived.by(() => {
		const rows = new Map<number, number>();
		let lastX = -Infinity;
		let lastRow = 0;
		marks.forEach((m, i) => {
			if (!m.label || m.at < from || m.at > to) return;
			const px = x(m.at);
			lastRow = Math.abs(px - lastX) < 50 ? (lastRow + 1) % 3 : 0;
			rows.set(i, lastRow);
			lastX = px;
		});
		return rows;
	});
	const yTicks = $derived(symmetric ? [range.hi, 0, range.lo] : [range.hi, (range.hi + range.lo) / 2, range.lo]);
</script>

<div class="chart" bind:clientWidth={width} style:height="{height}px">
	{#if width > LEFT}
		<svg {width} {height} role="img" aria-label={label}>
			{#each bands as b, i (i)}
				{#if b.to > from && b.from < to}
					<rect x={x(Math.max(from, b.from))} y="0" width={Math.max(1, x(Math.min(to, b.to)) - x(Math.max(from, b.from)))} height={plotH} fill={b.fill} />
				{/if}
			{/each}
			{#each yTicks as v, i (i)}
				<line class="grid" x1={LEFT} x2={width} y1={y(v)} y2={y(v)} />
				<text class="ylab" x={LEFT - 5} y={y(v)} dy="0.35em" text-anchor="end">{format(v)}</text>
			{/each}
			{#each hlines as h, i (i)}
				<line x1={LEFT} x2={width} y1={y(h.y)} y2={y(h.y)} stroke={h.color ?? 'var(--muted)'} stroke-dasharray={h.dash ? '4 4' : undefined} stroke-width="1" />
				{#if h.label}<text class="hlab" x={width - 2} y={y(h.y) - 3} text-anchor="end" fill={h.color ?? 'var(--muted)'}>{h.label}</text>{/if}
			{/each}
			{#each marks as m, i (i)}
				{#if m.at >= from && m.at <= to}
					<line x1={x(m.at)} x2={x(m.at)} y1="0" y2={plotH} stroke={m.color ?? 'var(--faint)'} stroke-dasharray={m.dash ? '3 3' : undefined} stroke-width="1" />
					{#if m.label}<text class="mlab" x={x(m.at) + 3} y={10 + (labelRow.get(i) ?? 0) * 11} fill={m.color ?? 'var(--muted)'}>{m.label}</text>{/if}
				{/if}
			{/each}
			<clipPath id="clip-{clipId}"><rect x={LEFT} y="0" width={Math.max(0, width - LEFT)} height={plotH} /></clipPath>
			<g clip-path="url(#clip-{clipId})">
			{#each series as s, i (i)}
				{#if s.kind === 'dots'}
					{#each s.points as [t, v], j (j)}
						{#if v !== null && t >= from && t <= to}<circle cx={x(t)} cy={y(v)} r={s.radius?.(j) ?? 2.2} fill={s.color} />{/if}
					{/each}
				{:else}
					<path d={path(s)} stroke={s.color} stroke-width={s.width ?? 1.5} stroke-dasharray={s.dash} fill="none" stroke-linejoin="round" />
				{/if}
			{/each}
			</g>
			{#if axis}
				{#each ticks as t (t)}
					<line class="tick" x1={x(t)} x2={x(t)} y1={plotH} y2={plotH + 3} />
					<text class="xlab" x={x(t)} y={height - 3} text-anchor="middle">{clock(t * 1000)}</text>
				{/each}
			{/if}
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
	.ylab,
	.xlab {
		fill: var(--faint);
	}
	.mlab,
	.hlab {
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
