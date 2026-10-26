<script lang="ts">
	import { clock } from '$lib/format';
	import type { ForecastHour, ForecastLead } from '$lib/types';

	/** C4: cloud seen in the frames per hour (bars) against each model's forecast (lines), 0–100 %, the clear line dashed. */
	let {
		hours,
		models,
		lead,
		clearPct,
		height = 150
	}: { hours: ForecastHour[]; models: { id: string; label: string }[]; lead: ForecastLead; clearPct: number; height?: number } = $props();

	const COLORS = ['var(--line1)', 'var(--line2)', 'var(--line3)', 'var(--line4)'];
	const LEFT = 34;
	const AXIS_H = 18;
	let width = $state(0);
	const plotH = $derived(height - AXIS_H);
	/** Every hour from the first to the last, also those without frames. */
	const slots = $derived.by(() => {
		if (!hours.length) return [];
		const byTime = new Map(hours.map((h) => [h.time, h]));
		const out: { time: number; hour: ForecastHour | null }[] = [];
		for (let t = hours[0].time; t <= hours[hours.length - 1].time; t += 3600) out.push({ time: t, hour: byTime.get(t) ?? null });
		return out;
	});
	const slot = $derived((width - LEFT) / Math.max(1, slots.length));
	const cx = (i: number) => LEFT + (i + 0.5) * slot;
	const y = (v: number) => 4 + (1 - v / 100) * (plotH - 8);
	const every = $derived(Math.max(1, Math.ceil(36 / Math.max(1, slot))));

	function path(id: string): string {
		let d = '';
		let pen = false;
		slots.forEach((s, i) => {
			const v = s.hour?.models[id]?.[lead] ?? null;
			if (v === null) {
				pen = false;
				return;
			}
			d += `${pen ? 'L' : 'M'}${cx(i).toFixed(1)},${y(v).toFixed(1)}`;
			pen = true;
		});
		return d;
	}
	const tip = (s: { time: number; hour: ForecastHour | null }) => {
		const h = s.hour;
		if (!h) return `${clock(s.time * 1000)}: no frames`;
		const seen = h.observed === null ? `too little exposure judged (${Math.round(h.exposureS / 60)} min)` : `seen ${h.observed} % (${h.cloudyFrames} of ${h.frames} frames cloudy)`;
		const forecasts = models.map((m) => {
			const f = h.models[m.id];
			return `${m.label} ${f?.[lead] ?? '–'} %${lead === 'latest' && f ? ` (low ${f.low ?? '–'}, mid ${f.mid ?? '–'}, high ${f.high ?? '–'})` : ''}`;
		});
		return [`${clock(s.time * 1000)}: ${seen}`, ...forecasts].join('\n');
	};
</script>

<div class="chart" bind:clientWidth={width} style:height="{height}px">
	{#if width > LEFT && slots.length}
		<svg {width} {height} role="img" aria-label="Cloud seen in the frames against the forecasts, per hour">
			{#each [100, 50, 0] as v (v)}
				<line class="grid" x1={LEFT} x2={width} y1={y(v)} y2={y(v)} />
				<text class="lab" x={LEFT - 5} y={y(v)} dy="0.35em" text-anchor="end">{v} %</text>
			{/each}
			{#each slots as s, i (s.time)}
				<g>
					<title>{tip(s)}</title>
					<rect class="hit" x={LEFT + i * slot} y="0" width={slot} height={plotH} />
					{#if s.hour?.observed !== null && s.hour?.observed !== undefined}
						<rect class="seen" x={LEFT + i * slot + slot * 0.12} y={y(Math.max(2, s.hour.observed))} width={slot * 0.76} height={y(0) - y(Math.max(2, s.hour.observed))} rx="2" />
					{:else if s.hour}
						<rect class="unjudged" x={LEFT + i * slot + slot * 0.12} y={y(100)} width={slot * 0.76} height={y(0) - y(100)} rx="2" />
					{/if}
				</g>
				{#if i % every === 0}<text class="lab" x={cx(i)} y={height - 4} text-anchor="middle">{clock(s.time * 1000)}</text>{/if}
			{/each}
			<line x1={LEFT} x2={width} y1={y(clearPct)} y2={y(clearPct)} class="clear" />
			{#each models as m, k (m.id)}
				<path d={path(m.id)} stroke={COLORS[k % COLORS.length]} stroke-width="1.8" fill="none" stroke-linejoin="round" pointer-events="none" />
				{#each slots as s, i (s.time)}
					{@const v = s.hour?.models[m.id]?.[lead] ?? null}
					{#if v !== null}<circle cx={cx(i)} cy={y(v)} r="2.4" fill={COLORS[k % COLORS.length]} pointer-events="none" />{/if}
				{/each}
			{/each}
		</svg>
	{/if}
</div>
<div class="legend">
	<span><i class="seen-key"></i>Seen in the frames</span>
	{#each models as m, k (m.id)}
		<span><i style:background={COLORS[k % COLORS.length]}></i>{m.label}</span>
	{/each}
	<span class="faint">dashed: clear ≤ {clearPct} %</span>
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
	.clear {
		stroke: var(--muted);
		stroke-dasharray: 4 4;
	}
	.hit {
		fill: transparent;
	}
	.seen {
		fill: rgba(var(--cloud), 0.38);
	}
	.unjudged {
		fill: none;
		stroke: var(--border);
		stroke-dasharray: 2 3;
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
	.seen-key {
		background: rgba(var(--cloud), 0.38);
	}
</style>
