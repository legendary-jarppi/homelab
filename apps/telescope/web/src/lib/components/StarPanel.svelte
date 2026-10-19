<script lang="ts">
	import type { StarMeasure } from '$lib/types';
	import { formatDec, formatRa } from '$lib/format';
	import type { Wcs } from '$lib/wcs';

	/** B1: the star nearest a click, measured by the service or processor: centroid, FWHM, HFR, shape, SNR, peak, its radial profile. */
	let { star, busy, error, wcs, scaleArcsec }: { star: StarMeasure | null; busy: boolean; error: string | null; wcs: Wcs | null; scaleArcsec: number | null } = $props();

	const W = 260;
	const H = 120;
	const fwhmArcsec = $derived(star?.fwhmArcsec ?? (star?.fwhmPx !== undefined && scaleArcsec ? star.fwhmPx * scaleArcsec : null));
	const sky = $derived(star?.found && wcs && star.x !== undefined && star.y !== undefined ? wcs.pixelToWorld(star.x, star.y) : null);

	/** The profile's points and a Gaussian of the measured FWHM through its peak, on one scale. */
	const chart = $derived.by(() => {
		const profile = star?.profile ?? [];
		if (!profile.length) return null;
		const rMax = Math.max(...profile.map(([r]) => r), 1);
		const top = Math.max(...profile.map(([, v]) => v), 1e-9);
		const min = Math.min(0, ...profile.map(([, v]) => v));
		const x = (r: number) => (r / rMax) * W;
		const y = (v: number) => H - ((v - min) / (top - min)) * H;
		const sigma = star?.fwhmPx ? star.fwhmPx / 2.3548 : null;
		const gauss = sigma ? Array.from({ length: 61 }, (_, i) => (i / 60) * rMax).map((r) => `${x(r).toFixed(1)},${y(top * Math.exp((-r * r) / (2 * sigma * sigma))).toFixed(1)}`).join(' ') : null;
		return { points: profile.map(([r, v]) => [x(r), y(v)] as const), gauss, half: y(top / 2), hwhm: star?.fwhmPx ? x(star.fwhmPx / 2) : null, zero: y(0), rMax };
	});
	const n = (v: number | undefined | null, digits = 2) => (v === undefined || v === null ? '–' : v.toFixed(digits));
</script>

<div class="star">
	{#if busy}
		<p class="muted">Measuring…</p>
	{:else if error}
		<p class="warn">{error}</p>
	{:else if !star}
		<p class="muted">Tap or click a star to measure it.</p>
	{:else if !star.found}
		<p class="muted">No star within 12 px of that point.</p>
	{:else}
		<dl class="num">
			<div><dt>FWHM</dt><dd>{n(star.fwhmPx)} px{fwhmArcsec !== null ? ` · ${n(fwhmArcsec)}″` : ''}</dd></div>
			<div><dt>HFR</dt><dd>{n(star.hfrPx)} px</dd></div>
			<div><dt>Elongation</dt><dd>{n(star.elongation)}{star.angleDeg !== undefined ? ` at ${Math.round(star.angleDeg)}°` : ''}</dd></div>
			<div><dt>SNR</dt><dd>{star.snr !== undefined ? Math.round(star.snr) : '–'}</dd></div>
			<div><dt>Peak</dt><dd>{n(star.peak, star.linear === false ? 0 : 1)}{star.saturated ? ' · saturated' : ''}</dd></div>
			<div><dt>Background</dt><dd>{n(star.background, star.linear === false ? 0 : 1)}</dd></div>
			<div><dt>Centroid</dt><dd>{n(star.x, 1)}, {n(star.y, 1)}</dd></div>
			{#if sky}<div><dt>RA / Dec</dt><dd>{formatRa(sky[0])} {formatDec(sky[1])}</dd></div>{/if}
		</dl>
		{#if star.saturated}<p class="warn small">Saturated: the core is clipped, FWHM and HFR read too large.</p>{/if}
		{#if star.linear === false}<p class="muted small">Measured on a stretched 8-bit image: shape and centroid hold, brightness numbers do not.</p>{/if}
		{#if chart}
			<svg viewBox="-4 -4 {W + 8} {H + 22}" role="img" aria-label="Radial profile">
				<line class="axis" x1="0" x2={W} y1={chart.zero} y2={chart.zero} />
				<line class="half" x1="0" x2={W} y1={chart.half} y2={chart.half} />
				{#if chart.hwhm !== null}<line class="half" x1={chart.hwhm} x2={chart.hwhm} y1="0" y2={H} />{/if}
				{#if chart.gauss}<polyline class="fit" points={chart.gauss} />{/if}
				{#each chart.points as [px, py], i (i)}<circle cx={px} cy={py} r="1.6" />{/each}
				<text x="0" y={H + 15}>0</text>
				<text x={W} y={H + 15} text-anchor="end">{chart.rMax.toFixed(0)} px</text>
				{#if chart.hwhm !== null}<text x={chart.hwhm + 3} y="10">½ FWHM</text>{/if}
			</svg>
		{/if}
	{/if}
</div>

<style>
	.star {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	p {
		margin: 0;
		font-size: 14px;
	}
	.small {
		font-size: 12px;
	}
	dl {
		margin: 0;
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 6px 12px;
	}
	dl div {
		min-width: 0;
	}
	dt {
		font-size: 11px;
		color: var(--muted);
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}
	dd {
		margin: 0;
		font-size: 14px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	svg {
		width: 100%;
		height: auto;
		background: rgba(0, 0, 0, 0.4);
		border: 1px solid var(--border);
		border-radius: 8px;
	}
	circle {
		fill: var(--text);
	}
	.fit {
		fill: none;
		stroke: var(--accent);
		stroke-width: 1.5;
	}
	.axis {
		stroke: var(--faint);
	}
	.half {
		stroke: var(--muted);
		stroke-dasharray: 3 3;
	}
	text {
		fill: var(--muted);
		font-size: 10px;
	}
</style>
