<script lang="ts">
	import type { ImageMeta } from '$lib/types';

	/** B1: the image's per-channel histogram (linear data scaled 0–1 over its range), log or linear counts, with each channel's median. */
	let { histogram, stats }: { histogram: NonNullable<ImageMeta['histogram']>; stats: ImageMeta['stats'] } = $props();

	let log = $state(true);
	const CHANNELS = ['r', 'g', 'b'] as const;
	const NAMES = { r: 'Red', g: 'Green', b: 'Blue' };
	const W = 256;
	const H = 100;

	/** Area paths per channel, all on one scale (the highest bin of the three). */
	const paths = $derived.by(() => {
		const scale = (v: number) => (log ? Math.log10(1 + v) : v);
		const top = Math.max(1e-9, ...CHANNELS.flatMap((c) => histogram[c].map(scale)));
		return CHANNELS.map((c) => {
			const bins = histogram[c];
			const step = W / bins.length;
			const points = bins.map((v, i) => `${(i * step).toFixed(2)},${(H - (scale(v) / top) * H).toFixed(2)} ${((i + 1) * step).toFixed(2)},${(H - (scale(v) / top) * H).toFixed(2)}`);
			return { channel: c, d: `M0,${H} L${points.join(' ')} L${W},${H} Z` };
		});
	});
	const fmt = (v: number | null | undefined) => (v === null || v === undefined ? '–' : v < 0.01 ? v.toExponential(1) : v.toFixed(3));
</script>

<div class="histogram">
	<div class="head">
		<span class="muted small">Linear data, 0–1 over its range</span>
		<button class="btn" onclick={() => (log = !log)} aria-pressed={log}>{log ? 'Log' : 'Linear'}</button>
	</div>
	<svg viewBox="0 0 {W} {H}" preserveAspectRatio="none" role="img" aria-label="Histogram of the red, green and blue channels">
		{#each paths as p (p.channel)}<path class="area {p.channel}" d={p.d} />{/each}
		{#if stats}
			{#each CHANNELS as c (c)}
				{@const m = stats[c]?.median}
				{#if m !== null && m !== undefined && m >= 0 && m <= 1}<line class="median {c}" x1={m * W} x2={m * W} y1="0" y2={H} />{/if}
			{/each}
		{/if}
	</svg>
	{#if stats}
		<table class="small num">
			<thead><tr><th></th><th>Median</th><th>Noise</th></tr></thead>
			<tbody>
				{#each CHANNELS as c (c)}
					<tr><th class={c}>{NAMES[c]}</th><td>{fmt(stats[c]?.median)}</td><td>{fmt(stats[c]?.noise)}</td></tr>
				{/each}
			</tbody>
		</table>
	{/if}
</div>

<style>
	.histogram {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
	}
	.small {
		font-size: 12px;
	}
	svg {
		width: 100%;
		height: 110px;
		background: rgba(0, 0, 0, 0.4);
		border: 1px solid var(--border);
		border-radius: 8px;
	}
	.area {
		mix-blend-mode: screen;
		stroke-width: 1;
		vector-effect: non-scaling-stroke;
	}
	.area.r {
		fill: rgba(248, 113, 113, 0.55);
		stroke: #f87171;
	}
	.area.g {
		fill: rgba(52, 211, 153, 0.5);
		stroke: #34d399;
	}
	.area.b {
		fill: rgba(96, 165, 250, 0.5);
		stroke: #60a5fa;
	}
	.median {
		stroke-width: 1;
		stroke-dasharray: 3 3;
		vector-effect: non-scaling-stroke;
	}
	.median.r,
	th.r {
		stroke: #f87171;
		color: #f87171;
	}
	.median.g,
	th.g {
		stroke: #34d399;
		color: #34d399;
	}
	.median.b,
	th.b {
		stroke: #60a5fa;
		color: #60a5fa;
	}
	/* Red night mode: shades of red, the channels told apart by outline dashes. */
	:global(:root.red) .area {
		fill: rgba(255, 30, 10, 0.18);
		mix-blend-mode: normal;
	}
	:global(:root.red) .area.r,
	:global(:root.red) .median.r,
	:global(:root.red) th.r {
		stroke: var(--line1);
		color: var(--line1);
	}
	:global(:root.red) .area.g,
	:global(:root.red) .median.g,
	:global(:root.red) th.g {
		stroke: var(--line3);
		color: var(--line3);
		stroke-dasharray: 4 2;
	}
	:global(:root.red) .area.b,
	:global(:root.red) .median.b,
	:global(:root.red) th.b {
		stroke: var(--line2);
		color: var(--line2);
		stroke-dasharray: 1 2;
	}
	table {
		border-collapse: collapse;
		width: 100%;
	}
	th,
	td {
		text-align: right;
		padding: 2px 6px;
		font-weight: 500;
	}
	th:first-child {
		text-align: left;
	}
	thead th {
		color: var(--muted);
	}
</style>
