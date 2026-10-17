<script lang="ts">
	import AreaChart from './AreaChart.svelte';
	import Card from './Card.svelte';
	import { clock } from '$lib/dates';
	import type { Point, TelescopeData, TelescopeFrame } from '$lib/types';

	/**
	 * The session's frames oldest to newest (without a session: the newest frames' run, same target and mode
	 * as the newest frame): sky background (rises with the moon, lit clouds, dawn), star count (drops with
	 * clouds, fog, dew) and HFR (rises when focus drifts or seeing worsens).
	 */
	let { telescope }: { telescope: TelescopeData | null } = $props();

	const session = $derived(telescope?.session ?? null);
	const newest = $derived(telescope?.frames[0] ?? null);
	const frames = $derived(
		(telescope?.frames ?? [])
			.filter((f) => (session ? f.target === session.target && f.at >= session.firstFrameAt : f.target === newest?.target && f.mode === newest.mode))
			.sort((a, b) => a.at - b.at)
	);
	/** "Last session · M 31 · 3.9." when no session is running. */
	const title = $derived(
		session || !newest
			? 'Sky quality'
			: `Last session · ${newest.target} · ${new Intl.DateTimeFormat('fi-FI', { timeZone: 'Europe/Helsinki', day: 'numeric', month: 'numeric' }).format(newest.at * 1000)}`
	);
	const METRICS: { id: 'backgroundAdu' | 'stars' | 'hfr'; label: string; color: string; unit: string; digits: number }[] = [
		{ id: 'backgroundAdu', label: 'Background', color: '#fbbf24', unit: 'ADU', digits: 0 },
		{ id: 'stars', label: 'Stars', color: '#38bdf8', unit: '', digits: 0 },
		{ id: 'hfr', label: 'HFR', color: '#c084fc', unit: 'px', digits: 1 }
	];
	/** Each measurement relative to its own peak, so the three trends share one chart. */
	const series = $derived(
		METRICS.map((m) => {
			const points = frames.filter((f: TelescopeFrame) => f[m.id] !== null).map((f): Point => [f.at, f[m.id] as number]);
			const peak = Math.max(...points.map((p) => p[1]));
			return { ...m, latest: points.at(-1)?.[1] ?? null, points: peak > 0 ? points.map(([t, v]): Point => [t, v / peak]) : [] };
		}).filter((m) => m.latest !== null)
	);
</script>

{#snippet accessory()}
	{#if frames.length > 0}<span class="num">{clock(frames[0].at * 1000)}–{clock(frames[frames.length - 1].at * 1000)} · {frames.length} frames</span>{/if}
{/snippet}

<Card {title} {accessory}>
	{#if frames.length === 0}
		<p class="muted">No data.</p>
	{:else if frames.length < 2}
		<p class="muted">Chart after the second frame.</p>
	{:else}
		<ul class="legend">
			{#each series as m (m.id)}
				<li><i style:background={m.color}></i>{m.label} <span class="num value">{m.latest?.toFixed(m.digits)}{m.unit ? ` ${m.unit}` : ''}</span></li>
			{/each}
		</ul>
		<div class="chart">
			<AreaChart series={series.map((m) => ({ id: `sky-${m.id}`, points: m.points, color: m.color }))} height={84} fixedMax={1} />
		</div>
		<p class="faint small">Each line on its own scale, oldest frame on the left.</p>
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
	.legend {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-wrap: wrap;
		gap: 4px 16px;
		font-size: 13px;
		color: var(--muted);
	}
	.legend i {
		display: inline-block;
		width: 8px;
		height: 8px;
		margin-right: 6px;
		border-radius: 50%;
	}
	.chart {
		flex: 1;
		min-height: 0;
		display: flex;
		align-items: flex-end;
	}
	.value {
		color: var(--text);
		font-weight: 600;
	}
</style>
