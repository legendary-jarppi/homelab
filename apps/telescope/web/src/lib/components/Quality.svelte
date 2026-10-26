<script lang="ts">
	import Card from './Card.svelte';
	import TimeChart from './TimeChart.svelte';
	import type { Frame } from '$lib/types';

	/**
	 * Each frame's stars, HFR and sky background over the session, rejected frames as large amber dots: what the
	 * rejection judged; R6: the sky brightness (mag/arcsec²) and zero point once the service measured them.
	 */
	let { frames }: { frames: Frame[] } = $props();

	type Key = 'stars' | 'hfr' | 'backgroundAdu' | 'skyMag' | 'zeroPoint';
	const from = $derived(frames[0]?.at ?? 0);
	const to = $derived((frames.at(-1)?.at ?? 0) + (frames.at(-1)?.exposureS ?? 0));
	const measured = $derived(frames.some((f) => f.skyMag !== null && f.skyMag !== undefined));
	const rows: { key: Key; label: string; color: string; digits: number }[] = $derived([
		{ key: 'stars', label: 'Stars', color: 'var(--line1)', digits: 0 },
		{ key: 'hfr', label: 'HFR px', color: 'var(--line2)', digits: 1 },
		{ key: 'backgroundAdu', label: 'Background ADU', color: 'var(--line3)', digits: 0 },
		...(measured
			? [
					{ key: 'skyMag' as const, label: 'Sky mag/arcsec² (darker higher)', color: 'var(--line4)', digits: 1 },
					{ key: 'zeroPoint' as const, label: 'Zero point mag (falls with dew, haze, cloud)', color: 'var(--line1)', digits: 1 }
				]
			: [])
	]);
</script>

<Card title="Frame quality">
	{#if frames.length < 2}
		<p class="muted">Not enough frames yet.</p>
	{:else}
		{#each rows as r, i (r.key)}
			<span class="plabel">{r.label}</span>
			<TimeChart
				{from}
				{to}
				height={i === rows.length - 1 ? 76 : 60}
				axis={i === rows.length - 1}
				yFormat={(v) => v.toFixed(r.digits)}
				series={[
					{ points: frames.map((f) => [f.at, f[r.key] ?? null]), color: r.color, width: 1 },
					{ points: frames.map((f) => [f.at, f[r.key] ?? null]), color: r.color, kind: 'dots', radius: () => 2 },
					{ points: frames.map((f) => [f.at, f.accepted ? null : (f[r.key] ?? null)]), color: 'var(--warn)', kind: 'dots', radius: () => 4 }
				]}
				gapS={3600}
				label={r.label}
			/>
		{/each}
	{/if}
</Card>

<style>
	p {
		margin: 0;
	}
	.plabel {
		font-size: 11px;
		color: var(--faint);
	}
</style>
