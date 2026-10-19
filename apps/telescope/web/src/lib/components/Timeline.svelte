<script lang="ts">
	import Card from './Card.svelte';
	import TimeChart, { type ChartMark } from './TimeChart.svelte';
	import { clock } from '$lib/format';
	import { altitude, LOW_ALTITUDE, moonAltitude, nightNoon, setsBelow, sky as nightSky, transit } from '$lib/sky';
	import type { SessionDetail, TimelineKind } from '$lib/types';

	/**
	 * A3: the session on the night's time axis (sunset to sunrise): the target's altitude (from the FITS header's
	 * RA/Dec and the site) with the meridian and the 20° line, the moon, darkness shaded; under it the events
	 * (plan, GoTo, centering, auto focus, meridian flip, guiding lost) and every frame (accepted / rejected), the
	 * estimated finish, and the events as a list.
	 */
	let { session, site, nowS, finishS = null }: { session: SessionDetail; site: { lat: number; lon: number } | null; nowS: number; finishS?: number | null } = $props();

	const LEFT = 38;
	const KINDS: Partial<Record<TimelineKind, { short: string; label: string }>> = {
		plan_start: { short: '▶', label: 'Plan start' },
		plan_end: { short: '■', label: 'Plan end' },
		target_start: { short: 'T', label: 'Target' },
		goto: { short: 'G', label: 'GoTo' },
		centering: { short: 'C', label: 'Centering' },
		autofocus: { short: 'AF', label: 'Auto focus' },
		meridian_flip: { short: 'MF', label: 'Meridian flip' },
		guiding_lost: { short: '!', label: 'Guiding lost' }
	};

	const where = $derived(session.site ?? site);
	const night = $derived(where ? nightSky(where.lat, where.lon, nightNoon(session.night)) : null);
	const events = $derived(session.timeline.filter((e) => e.kind !== 'frame'));
	const span = $derived.by(() => {
		const exposure = session.exposureS ?? 0;
		const times = [session.firstFrameAt, session.lastFrameAt + exposure, ...events.map((e) => e.at)];
		if (finishS) times.push(finishS);
		if (session.active) times.push(nowS);
		let from = Math.min(...times);
		let to = Math.max(...times);
		if (night?.sunset) from = Math.min(from, night.sunset / 1000);
		if (night?.sunrise) to = Math.max(to, night.sunrise / 1000);
		return { from: from - 600, to: to + 600 };
	});
	const hasTarget = $derived(where !== null && session.ra !== null && session.dec !== null);
	const curve = $derived.by(() => {
		if (!where || session.ra === null || session.dec === null) return { target: [], moon: [] };
		const target: [number, number][] = [];
		const moon: [number, number][] = [];
		for (let t = span.from; t <= span.to; t += 600) {
			target.push([t, altitude(session.ra, session.dec, where.lat, where.lon, t * 1000)]);
			moon.push([t, moonAltitude(where.lat, where.lon, t * 1000)]);
		}
		return { target, moon };
	});
	const meridian = $derived.by(() => {
		if (!where || session.ra === null) return null;
		const mid = ((span.from + span.to) / 2) * 1000;
		const t = transit(session.ra, where.lon, mid) / 1000;
		return t >= span.from && t <= span.to ? t : null;
	});
	const sets = $derived(
		where && session.ra !== null && session.dec !== null ? setsBelow(session.ra, session.dec, where.lat, where.lon, span.from * 1000, span.to * 1000) : null
	);
	const peak = $derived(curve.target.length ? Math.max(...curve.target.map(([, a]) => a)) : null);
	const bands = $derived.by(() => {
		const out: { from: number; to: number; fill: string }[] = [];
		if (night?.nautical) out.push({ from: night.nautical.start / 1000, to: night.nautical.end / 1000, fill: 'var(--dark)' });
		if (night?.astronomical) out.push({ from: night.astronomical.start / 1000, to: night.astronomical.end / 1000, fill: 'var(--dark)' });
		return out;
	});
	const marks = $derived.by(() => {
		const out: ChartMark[] = [];
		if (meridian) out.push({ at: meridian, label: 'Meridian', dash: true, color: 'var(--muted)' });
		if (sets) out.push({ at: sets / 1000, label: `< ${LOW_ALTITUDE}°`, color: 'var(--warn)', dash: true });
		if (session.active) out.push({ at: nowS, label: 'Now', color: 'var(--accent)' });
		if (finishS) out.push({ at: finishS, label: 'Finish', color: 'var(--ok)', dash: true });
		return out.sort((a, b) => a.at - b.at);
	});

	let laneWidth = $state(0);
	const x = (t: number) => LEFT + ((t - span.from) / (span.to - span.from)) * (laneWidth - LEFT);
	let showList = $state(false);
</script>

<Card title="Timeline">
	{#snippet accessory()}
		{#if night?.astronomical}<span class="num">dark {clock(night.astronomical.start)}–{clock(night.astronomical.end)}</span>{/if}
	{/snippet}
	<p class="summary">
		{#if hasTarget}
			{#if meridian}Meridian {clock(meridian * 1000)}{peak !== null ? ` at ${peak.toFixed(0)}°` : ''} · {/if}
			{#if sets}<span class="warn">sets below {LOW_ALTITUDE}° at {clock(sets)}</span>{:else}stays above {LOW_ALTITUDE}° through the night{/if}
		{:else}
			<span class="muted">No target coordinates{where ? '' : ' or site'}: altitude unknown.</span>
		{/if}
		{#if finishS} · <span class="ok">finish ≈ {clock(finishS * 1000)}</span>{/if}
	</p>
	{#if hasTarget}
		<TimeChart
			from={span.from}
			to={span.to}
			height={120}
			yMin={0}
			yMax={90}
			yFormat={(v) => `${Math.round(v)}°`}
			series={[
				{ points: curve.moon, color: 'var(--muted)', dash: '2 3', width: 1 },
				{ points: curve.target, color: 'var(--line1)', width: 2 }
			]}
			hlines={[{ y: LOW_ALTITUDE, color: 'var(--warn)', dash: true }]}
			{bands}
			{marks}
			axis={false}
			label="Target altitude"
		/>
	{/if}
	<div class="lane" bind:clientWidth={laneWidth}>
		{#if laneWidth > LEFT}
			<svg width={laneWidth} height="58" role="img" aria-label="Events and frames">
				<text class="lab" x={LEFT - 5} y="15" text-anchor="end">events</text>
				<text class="lab" x={LEFT - 5} y="37" text-anchor="end">frames</text>
				{#each events as e, i (i)}
					{@const k = KINDS[e.kind]}
					<g class="ev {e.kind}" transform="translate({x(e.at)},15)"><title>{clock(e.at * 1000)} {e.text}</title><circle r="7" /><text dy="0.35em" text-anchor="middle">{k?.short ?? '•'}</text></g>
				{/each}
				{#each session.frames as f (f.id)}
					<rect x={x(f.at)} y="29" width={Math.max(1.5, ((f.exposureS ?? 0) / (span.to - span.from)) * (laneWidth - LEFT))} height="16" class:rej={!f.accepted}><title>Frame {f.number ?? ''} {f.accepted ? 'accepted' : `rejected: ${f.rejectReason ?? ''}`}</title></rect>
				{/each}
				{#if finishS && session.active}
					<rect class="todo" x={x(nowS)} y="29" width={Math.max(0, x(finishS) - x(nowS))} height="16" />
				{/if}
			</svg>
			<div class="axis">
				<span>{clock(span.from * 1000)}</span>
				{#if night?.sunset}<span>sunset {clock(night.sunset)}</span>{/if}
				{#if night?.sunrise}<span>sunrise {clock(night.sunrise)}</span>{/if}
				<span>{clock(span.to * 1000)}</span>
			</div>
		{/if}
	</div>
	{#if events.length}
		<button class="toggle" onclick={() => (showList = !showList)} aria-expanded={showList}>{showList ? 'Hide' : 'Show'} {events.length} events</button>
		{#if showList}
			<ol class="list">
				{#each events as e, i (i)}
					<li><span class="num muted">{clock(e.at * 1000)}</span><span class="tag">{KINDS[e.kind]?.label ?? e.kind}</span><span>{e.text}</span></li>
				{/each}
			</ol>
		{/if}
	{/if}
</Card>

<style>
	.summary {
		margin: 0;
		font-size: 14px;
	}
	.ok {
		color: var(--ok);
	}
	.lane svg {
		display: block;
	}
	.lab {
		font-size: 10px;
		fill: var(--faint);
	}
	.ev circle {
		fill: var(--surface-strong);
		stroke: var(--muted);
	}
	.ev text {
		font-size: 7.5px;
		font-weight: 700;
		fill: var(--text);
	}
	.ev.meridian_flip circle,
	.ev.autofocus circle {
		stroke: var(--line2);
	}
	.ev.guiding_lost circle {
		stroke: var(--warn);
	}
	rect {
		fill: var(--ok);
		opacity: 0.75;
	}
	rect.rej {
		fill: var(--warn);
		opacity: 1;
	}
	rect.todo {
		fill: none;
		stroke: var(--faint);
		stroke-dasharray: 3 3;
		opacity: 1;
	}
	.axis {
		display: flex;
		justify-content: space-between;
		gap: 8px;
		padding-left: 38px;
		font-size: 10px;
		color: var(--faint);
		font-variant-numeric: tabular-nums;
	}
	.toggle {
		align-self: flex-start;
		padding: 4px 10px;
		border-radius: 999px;
		border: 1px solid var(--border);
		background: var(--surface);
		color: var(--muted);
		font-size: 12px;
		cursor: pointer;
	}
	.list {
		margin: 0;
		padding: 0;
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: 4px;
		font-size: 13px;
	}
	.list li {
		display: grid;
		grid-template-columns: 44px 92px 1fr;
		gap: 8px;
	}
	.tag {
		color: var(--muted);
	}
</style>
