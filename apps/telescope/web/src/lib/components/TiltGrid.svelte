<script lang="ts">
	import type { TiltCell } from '$lib/types';

	/**
	 * A6: the sensor's 3×3 grid as a heat map of star FWHM (stronger = larger stars than the best cell), each cell
	 * with its numbers and a tick along the stars' dominant elongation (length grows with the elongation).
	 * `detail`: FWHM in px and ″, HFR, elongation and stars measured; otherwise FWHM only.
	 */
	let { cells, width, height, detail = false }: { cells: TiltCell[]; width: number | null; height: number | null; detail?: boolean } = $props();

	const CELL = 100;
	const aspect = $derived(width && height ? height / width : 1);
	const cellH = $derived(CELL * aspect);
	const sizes = $derived(cells.map((c) => c.fwhmPx).filter((v): v is number => v !== null));
	const low = $derived(sizes.length ? Math.min(...sizes) : 0);
	const high = $derived(sizes.length ? Math.max(...sizes) : 0);

	/** Heat 0…1: 0 = the best cell, 1 = 25 % or more larger (the spread a clear tilt shows). */
	const heat = (v: number | null) => (v === null || low <= 0 ? 0 : Math.min(1, (v - low) / (0.25 * low)));
	const tick = (c: TiltCell) => {
		if (c.angleDeg === null || c.elongation === null) return null;
		const half = Math.min(0.42 * CELL, (0.08 + 1.2 * c.elongation) * CELL);
		const a = (c.angleDeg * Math.PI) / 180;
		return { dx: Math.cos(a) * half, dy: Math.sin(a) * half };
	};
</script>

<svg class="grid" viewBox="0 0 {3 * CELL} {3 * cellH}" role="img" aria-label="Star size across the sensor, 3 by 3">
	{#each cells as c (`${c.row}-${c.col}`)}
		{@const x = c.col * CELL}
		{@const y = c.row * cellH}
		{@const t = tick(c)}
		<rect {x} {y} width={CELL} height={cellH} class="cell" style:fill="color-mix(in srgb, var(--warn) {Math.round(8 + 52 * heat(c.fwhmPx))}%, transparent)" />
		{#if t}<line class="tick" x1={x + CELL / 2 - t.dx} y1={y + cellH / 2 - t.dy} x2={x + CELL / 2 + t.dx} y2={y + cellH / 2 + t.dy} />{/if}
		{#if c.fwhmPx === null}
			<text x={x + CELL / 2} y={y + cellH / 2 + 4} class="none">{c.stars} stars</text>
		{:else if detail}
			<text x={x + CELL / 2} y={y + cellH / 2 - 22} class="main">{c.fwhmPx.toFixed(2)}</text>
			<text x={x + CELL / 2} y={y + cellH / 2 - 8} class="small">{c.fwhmArcsec !== null ? `${c.fwhmArcsec.toFixed(2)}″` : 'px'}</text>
			<text x={x + CELL / 2} y={y + cellH / 2 + 16} class="small">HFR {c.hfrPx?.toFixed(2) ?? '–'}</text>
			<text x={x + CELL / 2} y={y + cellH / 2 + 29} class="small">e {c.elongation?.toFixed(2) ?? '–'} · {c.stars}★</text>
		{:else}
			<text x={x + CELL / 2} y={y + cellH / 2 + 6} class="main">{c.fwhmPx.toFixed(2)}</text>
		{/if}
	{/each}
	{#each [1, 2] as k (k)}
		<line class="sep" x1={k * CELL} y1="0" x2={k * CELL} y2={3 * cellH} />
		<line class="sep" x1="0" y1={k * cellH} x2={3 * CELL} y2={k * cellH} />
	{/each}
</svg>

<style>
	.grid {
		display: block;
		width: 100%;
		height: auto;
		border: 1px solid var(--border);
		border-radius: 12px;
		overflow: hidden;
	}
	.cell {
		stroke: none;
	}
	.sep {
		stroke: var(--border);
		stroke-width: 1;
	}
	.tick {
		stroke: var(--muted);
		stroke-width: 3;
		stroke-linecap: round;
		opacity: 0.55;
	}
	text {
		text-anchor: middle;
		font-variant-numeric: tabular-nums;
		fill: var(--text);
	}
	.main {
		font-size: 18px;
		font-weight: 650;
	}
	.small {
		font-size: 11px;
		fill: var(--muted);
	}
	.none {
		font-size: 11px;
		fill: var(--faint);
	}
</style>
