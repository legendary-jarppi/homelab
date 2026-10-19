<script lang="ts">
	import { FIELD_ARCMIN, framing } from '$lib/catalog';

	/**
	 * The object's outline (catalog axes and position angle; north up, east left) against the camera's field,
	 * and the mosaic panels when it does not fit. Square, `size` px.
	 */
	let { maj, min, pa = null, size = 40, panels = false }: { maj: number | null; min: number | null; pa?: number | null; size?: number; panels?: boolean } = $props();

	const PANEL = FIELD_ARCMIN * 0.85;
	const fit = $derived(framing({ maj, min }));
	const grid = $derived.by(() => {
		const m = /^(\d+)×(\d+)/.exec(fit.label);
		return m ? { a: Number(m[1]), b: Number(m[2]) } : { a: 1, b: 1 };
	});
	/** Arcmin across the drawing. */
	const span = $derived(Math.max(FIELD_ARCMIN * 1.15, (maj ?? 0) * 1.1, panels ? (Math.max(grid.a, grid.b) - 1) * PANEL + FIELD_ARCMIN * 1.1 : 0));
	const k = $derived(size / span);
	const rx = $derived(Math.max(1, ((min ?? maj ?? 0) / 2) * k));
	const ry = $derived(Math.max(1, ((maj ?? 0) / 2) * k));
	const field = $derived(FIELD_ARCMIN * k);
	const tiles = $derived.by(() => {
		if (!panels || fit.kind !== 'mosaic') return [];
		// Panels along the object's long axis vertically (the drawing is not rotated to the position angle).
		const out: { x: number; y: number }[] = [];
		for (let i = 0; i < grid.b; i++) for (let j = 0; j < grid.a; j++) out.push({ x: size / 2 + (i - (grid.b - 1) / 2) * PANEL * k - field / 2, y: size / 2 + (j - (grid.a - 1) / 2) * PANEL * k - field / 2 });
		return out;
	});
</script>

<svg width={size} height={size} viewBox="0 0 {size} {size}" role="img" aria-label="Framing: {fit.label}">
	{#if maj !== null}
		<ellipse cx={size / 2} cy={size / 2} {rx} {ry} transform="rotate({-(pa ?? 0)} {size / 2} {size / 2})" class="object" />
	{/if}
	{#each tiles as t, i (i)}
		<rect x={t.x} y={t.y} width={field} height={field} class="panel" />
	{:else}
		<rect x={(size - field) / 2} y={(size - field) / 2} width={field} height={field} class="field" />
	{/each}
</svg>

<style>
	svg {
		flex: none;
		display: block;
		border-radius: 8px;
		background: rgba(0, 0, 0, 0.35);
	}
	.object {
		fill: var(--line2);
		fill-opacity: 0.35;
		stroke: var(--line2);
		stroke-width: 1;
	}
	.field,
	.panel {
		fill: none;
		stroke: var(--accent);
		stroke-width: 1.2;
	}
	.panel {
		stroke-dasharray: 3 2;
	}
</style>
