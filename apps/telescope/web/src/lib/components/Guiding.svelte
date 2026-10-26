<script lang="ts">
	import Card from './Card.svelte';
	import TimeChart, { type ChartMark } from './TimeChart.svelte';
	import { arcsec, guideGrade } from '$lib/format';
	import type { Frame, Guiding, Live, WindPoint } from '$lib/types';

	/**
	 * A4: guiding over the whole session: RA/Dec error with dithers, settling and lost star, the RMS in 5-minute
	 * windows, each frame's elongation and guiding RMS, the wind at the site (Open-Meteo) on the same axis, and a
	 * scatter of the error. `live`: the guider right now (state, star SNR), only on the Live page.
	 */
	let {
		guiding,
		frames,
		live = null,
		wind = null,
		windError = null
	}: { guiding: Guiding | null; frames: Frame[]; live?: Live['guiding']; wind?: WindPoint[] | null; windError?: string | null } = $props();

	const WINDOW_S = 300;
	const history = $derived(guiding?.history ?? []);
	const from = $derived(Math.min(history[0]?.[0] ?? Infinity, frames[0]?.at ?? Infinity));
	const to = $derived(Math.max(history.at(-1)?.[0] ?? -Infinity, (frames.at(-1)?.at ?? -Infinity) + (frames.at(-1)?.exposureS ?? 0)));
	const hasHistory = $derived(history.length > 1);
	const steady = $derived(history.filter((p) => !p[3]));
	const yMax = $derived(Math.max(2, Math.ceil(Math.max(0, ...steady.map(([, r, d]) => Math.max(Math.abs(r), Math.abs(d)))))));
	const clip = (v: number) => Math.max(-yMax, Math.min(yMax, v));

	/** Settling runs as shaded bands. */
	const settling = $derived.by(() => {
		const out: { from: number; to: number; fill: string }[] = [];
		let start: number | null = null;
		for (const [t, , , s] of history) {
			if (s && start === null) start = t;
			if (!s && start !== null) {
				out.push({ from: start, to: t, fill: 'var(--surface-strong)' });
				start = null;
			}
		}
		if (start !== null) out.push({ from: start, to: history.at(-1)![0], fill: 'var(--surface-strong)' });
		return out;
	});
	const marks = $derived(
		(guiding?.events ?? [])
			.filter((e) => e.kind !== 'settle')
			.map(
				(e): ChartMark =>
					e.kind === 'dither'
						? { at: e.at, color: 'var(--border)' }
						: e.kind === 'lost'
							? { at: e.at, color: 'var(--warn)', label: 'lost' }
							: { at: e.at, color: 'var(--muted)', label: e.kind, dash: true }
			)
	);
	const dithers = $derived((guiding?.events ?? []).filter((e) => e.kind === 'dither').length);

	/** PHD2's RMS (spread around the mean) per window of steady steps. */
	const rmsCurve = $derived.by(() => {
		const total: [number, number | null][] = [];
		const ra: [number, number | null][] = [];
		const dec: [number, number | null][] = [];
		const spread = (v: number[]) => {
			const mean = v.reduce((a, b) => a + b, 0) / v.length;
			return Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / v.length);
		};
		let bucket: (typeof steady)[number][] = [];
		let start = steady[0]?.[0] ?? 0;
		const flush = () => {
			if (bucket.length >= 5) {
				const t = (bucket[0][0] + bucket.at(-1)![0]) / 2;
				const r = spread(bucket.map((p) => p[1]));
				const d = spread(bucket.map((p) => p[2]));
				ra.push([t, r]);
				dec.push([t, d]);
				total.push([t, Math.hypot(r, d)]);
			}
			bucket = [];
		};
		for (const p of steady) {
			if (p[0] - start >= WINDOW_S) {
				flush();
				start = p[0];
			}
			bucket.push(p);
		}
		flush();
		return { total, ra, dec };
	});
	const hasElongation = $derived(frames.some((f) => f.elongation !== null));
	const hasFrameRms = $derived(frames.some((f) => f.guidingRmsArcsec !== null));
	const windPoints = $derived(wind?.filter((w) => w.time >= from - 3600 && w.time <= to + 3600) ?? []);

	let scatterSize = $state(0);
	const R = $derived(scatterSize / 2);
	const sx = (v: number) => R + (clip(v) / yMax) * (R - 4);
	const STATES: Record<string, string> = { LostLock: 'Lost lock' };
</script>

<Card title="Guiding">
	{#snippet accessory()}
		{#if live?.state}<span class="state" class:on={live.state === 'Guiding'} class:lost={live.state === 'LostLock'}><i></i>{STATES[live.state] ?? live.state}</span>{/if}
	{/snippet}
	{#if !guiding || (!hasHistory && guiding.rmsArcsec === null)}
		<p class="muted">No guiding recorded for this session{live ? '' : ' (sessions before the web app have none)'}.</p>
	{:else}
		<div class="numbers">
			<p class="rms {guideGrade(guiding.rmsArcsec)}"><span class="num">{arcsec(guiding.rmsArcsec)}″</span><small>RMS, session</small></p>
			<dl>
				<div><dt><i style:background="var(--ra)"></i>RA</dt><dd class="num">{arcsec(guiding.rmsRaArcsec)}″</dd></div>
				<div><dt><i style:background="var(--dec)"></i>Dec</dt><dd class="num">{arcsec(guiding.rmsDecArcsec)}″</dd></div>
				{#if live?.rmsArcsec != null}<div><dt>Now</dt><dd class="num">{arcsec(live.rmsArcsec)}″</dd></div>{/if}
				{#if live?.snr != null}<div><dt>SNR</dt><dd class="num">{live.snr.toFixed(0)}</dd></div>{/if}
				<div><dt>Dithers</dt><dd class="num">{dithers}</dd></div>
			</dl>
		</div>
		{#if hasHistory && to > from}
			<div class="panels">
				<div class="panel">
					<span class="plabel">Error ″ <i style:background="var(--ra)"></i>RA <i style:background="var(--dec)"></i>Dec · shaded: settling</span>
					<TimeChart
						{from}
						{to}
						height={110}
						symmetric
						yMax={yMax}
						yFormat={(v) => (v === 0 ? '0' : `${v > 0 ? '+' : '−'}${Math.abs(v).toFixed(0)}`)}
						series={[
							{ points: history.map(([t, r]) => [t, clip(r)]), color: 'var(--ra)', width: 1.1 },
							{ points: history.map(([t, , d]) => [t, clip(d)]), color: 'var(--dec)', width: 1.1 }
						]}
						bands={settling}
						{marks}
						gapS={120}
						axis={false}
						label="Guiding error over the session"
					/>
				</div>
				<div class="panel">
					<span class="plabel">RMS ″ per {WINDOW_S / 60} min</span>
					<TimeChart
						{from}
						{to}
						height={70}
						yMin={0}
						yFormat={(v) => v.toFixed(1)}
						series={[
							{ points: rmsCurve.ra, color: 'var(--ra)', width: 1, dash: '3 2' },
							{ points: rmsCurve.dec, color: 'var(--dec)', width: 1, dash: '3 2' },
							{ points: rmsCurve.total, color: 'var(--text)', width: 1.6 }
						]}
						hlines={[{ y: 1, color: 'var(--faint)', dash: true, label: '1″' }]}
						gapS={WINDOW_S * 3}
						axis={false}
						label="Guiding RMS over the session"
					/>
				</div>
				{#if hasElongation || hasFrameRms}
					<div class="panel">
						<span class="plabel">Frames: elongation{hasFrameRms ? ' · guiding RMS ″ (hollow)' : ''} · rejected larger</span>
						<TimeChart
							{from}
							{to}
							height={60}
							yMin={0}
							yFormat={(v) => v.toFixed(1)}
							series={[
								...(hasFrameRms ? [{ points: frames.map((f) => [f.at + (f.exposureS ?? 0) / 2, f.guidingRmsArcsec] as [number, number | null]), color: 'var(--muted)', kind: 'dots' as const, radius: () => 1.6 }] : []),
								{
									points: frames.map((f) => [f.at + (f.exposureS ?? 0) / 2, f.elongation] as [number, number | null]),
									color: 'var(--line2)',
									kind: 'dots',
									radius: (i: number) => (frames[i].accepted ? 2.4 : 4)
								}
							]}
							axis={false}
							label="Frame elongation"
						/>
					</div>
				{/if}
				<div class="panel">
					<span class="plabel">Wind m/s (solid) and gusts (dashed), Open-Meteo</span>
					{#if windPoints.length}
						<TimeChart
							{from}
							{to}
							height={74}
							yMin={0}
							series={[
								{ points: windPoints.map((w) => [w.time, w.wind]), color: 'var(--line3)', kind: 'step' },
								{ points: windPoints.map((w) => [w.time, w.gusts]), color: 'var(--line3)', kind: 'step', dash: '4 3', width: 1 }
							]}
							label="Wind at the site"
						/>
					{:else}
						<p class="muted small">Wind unavailable{windError ? `: ${windError}` : ''}.</p>
					{/if}
				</div>
			</div>
			<div class="scatter-row">
				<div class="scatter" bind:clientWidth={scatterSize} style:height="{scatterSize}px">
					{#if scatterSize > 0}
						<svg width={scatterSize} height={scatterSize} role="img" aria-label="Guiding error scatter">
							<line x1="0" x2={scatterSize} y1={R} y2={R} class="axisl" />
							<line y1="0" y2={scatterSize} x1={R} x2={R} class="axisl" />
							<circle cx={R} cy={R} r={(1 / yMax) * (R - 4)} class="ring" />
							{#if guiding.rmsArcsec}<circle cx={R} cy={R} r={(Math.min(guiding.rmsArcsec, yMax) / yMax) * (R - 4)} class="rmsring" />{/if}
							{#each steady as p, i (i)}<circle cx={sx(p[1])} cy={2 * R - sx(p[2])} r="1.3" class="pt" />{/each}
						</svg>
						<span class="corner">±{yMax}″</span>
					{/if}
				</div>
				<p class="muted small">
					RA right, Dec up; inner ring 1″, solid ring the session RMS. {guiding.samples ?? steady.length} steps outside settling.
				</p>
			</div>
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
		flex-wrap: wrap;
		gap: 4px 18px;
	}
	dt {
		display: flex;
		align-items: center;
		gap: 5px;
		font-size: 12px;
		color: var(--muted);
	}
	dt i,
	.plabel i {
		display: inline-block;
		width: 8px;
		height: 8px;
		border-radius: 50%;
	}
	dd {
		margin: 2px 0 0;
		font-size: 15px;
		font-weight: 550;
	}
	.panels {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.panel {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.plabel {
		display: flex;
		align-items: center;
		gap: 5px;
		font-size: 11px;
		color: var(--faint);
	}
	.scatter-row {
		display: grid;
		grid-template-columns: minmax(120px, 180px) 1fr;
		gap: 14px;
		align-items: center;
	}
	.scatter {
		position: relative;
	}
	.scatter svg {
		display: block;
	}
	.axisl {
		stroke: var(--border);
	}
	.ring {
		fill: none;
		stroke: var(--faint);
		stroke-dasharray: 3 3;
	}
	.rmsring {
		fill: none;
		stroke: var(--text);
	}
	.pt {
		fill: var(--ra);
		opacity: 0.45;
	}
	.corner {
		position: absolute;
		top: 0;
		right: 0;
		font-size: 10px;
		color: var(--faint);
	}
</style>
