<script lang="ts">
	import Card from './Card.svelte';
	import { fixed } from '$lib/format';
	import type { SessionDetail } from '$lib/types';

	/**
	 * R6: the session's sky (mag/arcsec² from the frames' photometry against Gaia BP) and the sub length it
	 * asks for (the service's `exposure`: read noise, sky electrons, read noise's share at the sub used).
	 */
	let { session }: { session: SessionDetail } = $props();

	/** A zero point this far below the session's best: the stars were dimmed (dew, haze, thin cloud). */
	const ZERO_POINT_DROP = 0.5;

	const accepted = $derived(session.frames.filter((f) => f.accepted));
	const sky = $derived(accepted.map((f) => f.skyMag).filter((v): v is number => v !== null && v !== undefined).sort((a, b) => a - b));
	const zps = $derived(accepted.map((f) => f.zeroPoint).filter((v): v is number => v !== null && v !== undefined));
	const bestZp = $derived(zps.length ? Math.max(...zps) : null);
	const worstZp = $derived(zps.length ? Math.min(...zps) : null);
	const dimmed = $derived(bestZp !== null && worstZp !== null && bestZp - worstZp > ZERO_POINT_DROP ? zps.filter((z) => bestZp - z > ZERO_POINT_DROP).length : 0);
	const e = $derived(session.exposure ?? null);
</script>

<Card title="Exposure">
	{#if !e && !sky.length}
		<p class="muted">Not measured yet: the sky is measured in plate-solved frames once the service has read noise from archived bias frames of this gain.</p>
	{:else}
		<dl class="facts">
			<div><dt>Sky</dt><dd class="num">{fixed(session.skyMag, 2)} <span class="unit">mag/″²</span></dd></div>
			{#if sky.length > 1}<div><dt>Range</dt><dd class="num">{sky[0].toFixed(2)}–{sky[sky.length - 1].toFixed(2)}</dd></div>{/if}
			<div><dt>Zero point</dt><dd class="num">{fixed(session.zeroPoint, 2)} <span class="unit">mag</span></dd></div>
			{#if e}
				<div><dt>Sky rate</dt><dd class="num">{e.skyEps.toPrecision(2)} <span class="unit">e-/s/px</span></dd></div>
				<div><dt>Read noise</dt><dd class="num">{e.readNoiseE.toFixed(2)} <span class="unit">e-</span></dd></div>
				{#if e.currentSubS !== null && e.readNoiseShare !== null}
					<div><dt>Read noise at {e.currentSubS} s</dt><dd class="num" class:warn={(e.noiseAddedPct ?? 0) > 5}>{Math.round(e.readNoiseShare * 100)} % <span class="unit">of variance</span></dd></div>
				{/if}
				<div><dt>Best sub</dt><dd class="num" class:ok={e.currentSubS !== null && e.currentSubS >= e.recommendedSubS}>{e.recommendedSubS} s</dd></div>
			{/if}
		</dl>
		{#if e}<p class="text">{e.text}</p>{/if}
		{#if dimmed}
			<p class="text warn">The zero point fell from {bestZp!.toFixed(2)} to {worstZp!.toFixed(2)} ({dimmed} of {zps.length} frames more than {ZERO_POINT_DROP} mag below the best): dew, haze or thin cloud dimmed the stars, and those frames' sky reads brighter than it was.</p>
		{/if}
		<p class="small faint">The green pixels calibrated against the Gaia BP magnitudes of the field's stars (ASTAP's D05 database); sky rate and read noise per camera pixel. Darker sky is a larger number.{session.filter ? ` Through the ${session.filter}: the sky in its passbands, darker than an unfiltered (SQM-like) reading.` : ''}</p>
	{/if}
</Card>

<style>
	p {
		margin: 0;
	}
	.facts {
		margin: 0;
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(118px, 1fr));
		gap: 10px 16px;
	}
	dt {
		font-size: 12px;
		color: var(--muted);
	}
	dd {
		margin: 2px 0 0;
		font-size: 16px;
		font-weight: 600;
	}
	.unit {
		font-size: 12px;
		font-weight: 400;
		color: var(--muted);
	}
	.text {
		font-size: 13px;
	}
	.small {
		font-size: 12px;
	}
	.warn {
		color: var(--warn);
	}
	.ok {
		color: var(--ok);
	}
</style>
