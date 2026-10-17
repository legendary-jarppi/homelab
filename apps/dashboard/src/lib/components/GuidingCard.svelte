<script lang="ts">
	import Card from './Card.svelte';
	import type { TelescopeData } from '$lib/types';

	/**
	 * The ASIAIR's guider from its live state: total RMS of the guiding error (RA and Dec beside it), the guider's state,
	 * the guide star's SNR, and a PHD2-style graph of the recent steps (RA and Dec error in arcsec over time).
	 */
	let { telescope }: { telescope: TelescopeData | null } = $props();

	const live = $derived(telescope?.live?.connected ? telescope.live : null);
	const guiding = $derived(live?.guiding ?? null);
	const history = $derived(guiding?.history ?? []);

	const RA_COLOR = '#38bdf8';
	const DEC_COLOR = '#f87171';
	const HEIGHT = 84;
	const STATES: Record<string, string> = { LostLock: 'Lost lock' };
	/** One decimal from 1″ up, two below. */
	const arcsec = (v: number | null) => (v === null ? '–' : v >= 1 ? v.toFixed(1) : v.toFixed(2));
	/** Main camera about 1.16″/px: under 1″ is good, up to 2″ still usable, beyond that stars elongate. */
	const grade = (v: number | null) => (v === null ? '' : v < 1 ? 'good' : v <= 2 ? '' : 'poor');

	let width = $state(0);
	/** Symmetric y scale, at least ±2″, in whole arcsec steps that hold the largest error. */
	const yMax = $derived(Math.max(2, Math.ceil(Math.max(0, ...history.map(([, ra, dec]) => Math.max(Math.abs(ra), Math.abs(dec)))))));
	const t0 = $derived(history[0]?.[0] ?? 0);
	const t1 = $derived(history.at(-1)?.[0] ?? 0);
	const spanMin = $derived(Math.round((t1 - t0) / 60));
	const y = (v: number) => HEIGHT / 2 - (Math.max(-yMax, Math.min(yMax, v)) / yMax) * (HEIGHT / 2 - 2);
	const line = (axis: 1 | 2) =>
		history.map((p, i) => `${i === 0 ? 'M' : 'L'}${(((p[0] - t0) / (t1 - t0)) * width).toFixed(1)},${y(p[axis]).toFixed(1)}`).join(' ');
</script>

{#snippet accessory()}
	{#if guiding?.state}
		<span class="state" class:on={guiding.state === 'Guiding'} class:lost={guiding.state === 'LostLock'}><i></i>{STATES[guiding.state] ?? guiding.state}</span>
	{/if}
{/snippet}

<Card title="Guiding" {accessory}>
	{#if !live}
		<p class="muted">No live connection.</p>
	{:else if !guiding}
		<p class="muted">Guiding not running.</p>
	{:else}
		<div class="numbers">
			<p class="rms {grade(guiding.rmsArcsec)}"><span class="num">{arcsec(guiding.rmsArcsec)}″</span><small>RMS</small></p>
			<dl>
				<div><dt><i style:background={RA_COLOR}></i>RA</dt><dd class="num">{arcsec(guiding.rmsRaArcsec)}″</dd></div>
				<div><dt><i style:background={DEC_COLOR}></i>Dec</dt><dd class="num">{arcsec(guiding.rmsDecArcsec)}″</dd></div>
				{#if guiding.snr !== null}<div><dt>SNR</dt><dd class="num">{guiding.snr.toFixed(0)}</dd></div>{/if}
			</dl>
		</div>
		{#if history.length > 1 && t1 > t0}
			<div class="graph" bind:clientWidth={width} style:height="{HEIGHT}px">
				{#if width > 0}
					<svg {width} height={HEIGHT} aria-label="Guiding error, last {spanMin} min">
						<line class="zero" x1="0" x2={width} y1={y(0)} y2={y(0)} />
						<line class="grid" x1="0" x2={width} y1={y(1)} y2={y(1)} />
						<line class="grid" x1="0" x2={width} y1={y(-1)} y2={y(-1)} />
						<path d={line(1)} stroke={RA_COLOR} />
						<path d={line(2)} stroke={DEC_COLOR} />
					</svg>
				{/if}
				<span class="axis top num">+{yMax}″</span>
				<span class="axis bottom num">−{yMax}″</span>
			</div>
			<p class="faint small">Last {spanMin} min{guiding.samples ? ` · RMS over ${guiding.samples} steps` : ''}{guiding.pixelScaleArcsec ? ` · guide camera ${guiding.pixelScaleArcsec.toFixed(2)}″/px` : ''}</p>
		{/if}
	{/if}
</Card>

<style>
	p {
		margin: 0;
		font-size: 14px;
	}
	.small {
		font-size: 12px;
	}
	.faint {
		color: var(--faint);
	}
	.state {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-weight: 600;
	}
	.state i {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: currentColor;
	}
	.state.on {
		color: var(--ok);
	}
	.state.lost {
		color: var(--warn);
	}
	.numbers {
		display: flex;
		align-items: flex-end;
		flex-wrap: wrap;
		gap: 6px 22px;
	}
	.rms {
		display: flex;
		align-items: baseline;
		gap: 6px;
	}
	.rms .num {
		font-size: 32px;
		font-weight: 650;
		line-height: 1;
		letter-spacing: -0.02em;
	}
	.rms small {
		font-size: 12px;
		color: var(--muted);
	}
	.rms.good .num {
		color: var(--ok);
	}
	.rms.poor .num {
		color: var(--warn);
	}
	dl {
		margin: 0;
		display: flex;
		gap: 18px;
	}
	dt {
		display: flex;
		align-items: center;
		gap: 5px;
		font-size: 12px;
		color: var(--muted);
	}
	dt i {
		width: 8px;
		height: 8px;
		border-radius: 50%;
	}
	dd {
		margin: 2px 0 0;
		font-size: 15px;
		font-weight: 550;
		white-space: nowrap;
	}
	.graph {
		position: relative;
		min-width: 0;
	}
	svg {
		display: block;
		overflow: visible;
	}
	path {
		fill: none;
		stroke-width: 1.5;
		stroke-linejoin: round;
	}
	.zero {
		stroke: var(--muted);
		stroke-width: 1;
		opacity: 0.6;
	}
	.grid {
		stroke: var(--border);
		stroke-width: 1;
		stroke-dasharray: 3 4;
	}
	.axis {
		position: absolute;
		left: 0;
		font-size: 10px;
		color: var(--faint);
		pointer-events: none;
	}
	.axis.top {
		top: 0;
	}
	.axis.bottom {
		bottom: 0;
	}
</style>
