<script lang="ts">
	import Card from '$lib/components/Card.svelte';
	import XYChart, { type XYSeries } from '$lib/components/XYChart.svelte';
	import { clock, fixed, nightLabel } from '$lib/format';
	import {
		DRIFT_END_FRAMES,
		DRIFT_MIN_FRAMES,
		MIN_CHECK_MOVES,
		MIN_RANGE_C,
		MIN_RUNS,
		NIGHT_COLORS,
		REFOCUS_WINDOW_S,
		TOLERANCE_PCT,
		VCURVE_MAX_RATIO,
		fitFocus,
		fitVCurve,
		hfrDrift,
		vCurveSeries,
		vCurveSize
	} from '$lib/focus';
	import type { AutofocusRun } from '$lib/types';

	/**
	 * A5: focuser position against temperature over every successful auto focus run (per-night zero points, one
	 * slope), the V-curves, and how the HFR drifted between runs against the temperature change. R6: the advice
	 * (tolerance from the V-curves, the coefficient, the ASIAIR's triggers) and its check against the frames.
	 */
	let { data } = $props();

	const runs = $derived(data.focus.runs);
	const ok = $derived(runs.filter((r) => r.success && r.temperatureC !== null && r.position !== null));
	const nights = $derived([...new Set(runs.map((r) => r.night ?? '?'))].sort());
	const colorOf = $derived(Object.fromEntries(nights.map((n, i) => [n, NIGHT_COLORS[i % NIGHT_COLORS.length]])));
	const fit = $derived(fitFocus(runs));

	const scatter = $derived.by((): XYSeries[] => {
		const out: XYSeries[] = [];
		for (const night of nights) {
			const pts = ok.filter((r) => (r.night ?? '?') === night);
			if (!pts.length) continue;
			const ts = pts.map((r) => r.temperatureC!);
			if (fit.slope !== null && pts.length >= 2 && fit.intercepts[night] !== undefined) {
				const lo = Math.min(...ts);
				const hi = Math.max(...ts);
				out.push({ points: [lo, hi].map((t) => [t, fit.intercepts[night] + fit.slope! * t] as [number, number]), color: colorOf[night], kind: 'line', width: 1, dash: '4 3' });
			}
			out.push({
				points: pts.map((r) => [r.temperatureC!, r.position!]),
				color: colorOf[night],
				kind: 'dots',
				radius: 3.2,
				title: (i) => `${nightLabel(night)} ${clock(pts[i].at * 1000)}: ${pts[i].position} at ${pts[i].temperatureC} °C (${pts[i].reason ?? ''})`
			});
		}
		return out;
	});

	// V-curves: one night at a time, one run highlighted.
	let night = $state<string | null>(null);
	let selectedAt = $state<number | null>(null);
	const shownNight = $derived(night ?? nights.at(-1) ?? null);
	const nightRuns = $derived(runs.filter((r) => (r.night ?? '?') === shownNight && r.points.length));
	const selected = $derived<AutofocusRun | null>(nightRuns.find((r) => r.at === selectedAt) ?? nightRuns.at(-1) ?? null);
	const selectedFit = $derived(selected?.success ? fitVCurve(selected) : null);
	const curves = $derived.by((): XYSeries[] => {
		if (!selected) return [];
		const others = nightRuns.filter((r) => r !== selected).flatMap((r) => vCurveSeries(r, 'var(--faint)', true));
		const own = vCurveSeries(selected, colorOf[shownNight ?? '?'] ?? 'var(--line1)');
		if (!selectedFit) return [...others, ...own];
		const xs = selected.points.filter((p) => p[2] === 1).map((p) => p[0]);
		const lo = Math.min(...xs);
		const hi = Math.max(...xs);
		const fitted: [number, number][] = Array.from({ length: 41 }, (_, i) => lo + ((hi - lo) * i) / 40).map((x) => [x, vCurveSize(selectedFit, x)]);
		return [...others, { points: fitted, color: 'var(--muted)', kind: 'line', width: 1, dash: '4 3' }, ...own];
	});

	// R6: the advice and its check against the frames.
	const analysis = $derived(data.analysis);
	const advice = $derived(analysis?.advice ?? null);
	const moveSeries = $derived.by((): XYSeries[] => {
		const moves = analysis?.moves ?? [];
		if (!moves.length) return [];
		const top = Math.max(10, ...moves.map((m) => Math.max(m.predictedPct, m.measuredPct)));
		return [
			{ points: [[0, 0], [top, top]], color: 'var(--border)', kind: 'line', width: 1, dash: '4 3' },
			...nights
				.map((n) => {
					const rows = moves.filter((m) => m.night === n);
					return {
						points: rows.map((m) => [m.predictedPct, m.measuredPct] as [number, number]),
						color: colorOf[n],
						kind: 'dots' as const,
						radius: 3.2,
						title: (i: number) => `${nightLabel(n)} ${clock(rows[i].at * 1000)} (${rows[i].reason ?? ''}): moved ${signed(rows[i].shiftSteps, 0)} steps, HFR ${rows[i].hfrBefore.toFixed(2)} → ${rows[i].hfrAfter.toFixed(2)}`
					};
				})
				.filter((s) => s.points.length)
		];
	});
	const triggerText = $derived.by(() => {
		const t = analysis?.triggers;
		if (!t) return null;
		const parts: string[] = [];
		if (t.temperatureDegC !== null)
			parts.push(`temperature ${t.temperatureDegC} °C (${t.temperatureRuns} runs, fired at ${[...new Set(t.firedAtC)].join('/') || '?'} °C, last ${nightLabel(t.temperatureNight ?? '', false)}${t.contradictedNight ? `; not firing on ${nightLabel(t.contradictedNight, false)}` : ''})`);
		if (t.hours !== null) parts.push(`every ${t.hours} h`);
		return parts.length ? parts.join(', ') : 'none seen';
	});

	const drift = $derived(hfrDrift(runs, data.frames));
	/** R6: each interval's air temperature change and predicted against measured HFR growth (advice.ts), by the first run. */
	const checked = $derived(new Map((analysis?.drift ?? []).map((d) => [d.from.at, d])));
	const driftSeries = $derived.by((): XYSeries[] =>
		nights
			.map((n) => {
				const rows = drift.filter((d) => d.night === n);
				return {
					points: rows.map((d) => [d.deltaC, d.deltaHfr] as [number, number]),
					color: colorOf[n],
					kind: 'dots' as const,
					radius: 3.2,
					title: (i: number) => `${nightLabel(n)} ${clock(rows[i].from.at * 1000)}–${clock(rows[i].to.at * 1000)}: HFR ${rows[i].hfrStart.toFixed(2)} → ${rows[i].hfrEnd.toFixed(2)}, ${rows[i].deltaC > 0 ? '+' : ''}${rows[i].deltaC} °C`
				};
			})
			.filter((s) => s.points.length)
	);
	const signed = (v: number, digits: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(digits)}`;
</script>

<main class="page">
	<Card title="Focus advice">
		{#if !analysis}
			<p class="muted">Unavailable: the telescope service did not answer (tried again within a minute).</p>
		{:else}
			{#if advice}
				<p class="advice">{advice.summary}</p>
			{:else}
				<p class="warn small">No advice yet: {analysis.fit.caveat ?? (analysis.fits.length ? 'no temperature coefficient.' : 'no V-curve could be fitted.')}</p>
			{/if}
			<dl class="facts">
				<div><dt>Tolerance ({TOLERANCE_PCT} % larger stars)</dt><dd class="num">{analysis.toleranceSteps !== null ? `${Math.round(analysis.toleranceSteps)} steps (${Math.round(analysis.toleranceQ1!)}–${Math.round(analysis.toleranceQ3!)})` : '–'}{advice ? ` · ${advice.toleranceDegC} °C` : ''}</dd></div>
				<div><dt>V-curves fitted</dt><dd class="num">{analysis.fits.length}{analysis.unfitted ? ` (${analysis.unfitted} not)` : ''}</dd></div>
				<div><dt>Coefficient</dt><dd class="num">{analysis.fit.slope !== null && analysis.fit.slopeSe !== null ? `${signed(analysis.fit.slope, 1)} ± ${analysis.fit.slopeSe.toFixed(1)} steps/°C` : '–'}</dd></div>
				<div><dt>ASIAIR triggers seen</dt><dd>{triggerText}</dd></div>
			</dl>
			{#if moveSeries.length}
				<XYChart series={moveSeries} height={200} xMin={0} yMin={Math.min(0, ...analysis.moves.map((m) => m.measuredPct))} xFormat={(v) => `${v.toFixed(0)} %`} yFormat={(v) => `${v.toFixed(0)} %`} xLabel="predicted from the run's V-curve" yLabel="HFR drop at the run" label="HFR drop at refocus against prediction" />
			{/if}
			<p class="small">{analysis.check}</p>
			<p class="muted small">
				Each V-curve fitted as a hyperbola, size = √(min² + (slope·(position − best))²): seeing and defocus blur add in quadrature, and defocus grows linearly with the offset; points over {VCURVE_MAX_RATIO}× the smallest are left out. The tolerance is where a curve is {TOLERANCE_PCT} % above its minimum ({TOLERANCE_PCT} % larger stars cost ~{Math.round(((1 + TOLERANCE_PCT / 100) ** 2 - 1) * 100)} % of the integration), median over the curves; in °C at the coefficient. The ASIAIR's settings are read from the reasons in its logs. Check (chart): at each run that moved the focuser, the median HFR of the session's last {DRIFT_END_FRAMES} frames before it against the first {DRIFT_END_FRAMES} after it (within {REFOCUS_WINDOW_S / 60} min), against the growth its own curve predicts for the move (dashed: as predicted); it needs {MIN_CHECK_MOVES} runs on each side of {TOLERANCE_PCT} %.
			</p>
		{/if}
	</Card>

	<Card title="Focus position against temperature">
		{#snippet accessory()}<span class="num muted">{ok.length} successful runs of {runs.length}, {nights.length} nights</span>{/snippet}
		{#if ok.length}
			<p class="result">
				{#if fit.slope !== null && fit.slopeSe !== null}
					<strong class="num">{signed(fit.slope, 1)} ± {fit.slopeSe.toFixed(1)} steps/°C</strong>
					<span class="muted">from {fit.runs} runs on {fit.nights} nights (widest span in a night {fit.rangeC} °C)</span>
				{:else}
					<strong>No coefficient</strong>
				{/if}
			</p>
			{#if fit.caveat}<p class="warn small">{fit.caveat}</p>{/if}
			<XYChart series={scatter} height={240} xFormat={(v) => `${v.toFixed(0)} °C`} yFormat={(v) => v.toFixed(0)} xLabel="focuser temperature, °C" yLabel="EAF position" label="Focus position against temperature" />
			<div class="legend">
				{#each nights as n (n)}
					{#if ok.some((r) => r.night === n)}<span><i style:background={colorOf[n]}></i>{nightLabel(n)}</span>{/if}
				{/each}
			</div>
			<p class="muted small">
				A dashed line per night with the common slope: the focuser's zero point moved between nights (≈5000 steps in February and April 2026, ≈6100 from September), so each night gets its own offset and only the change within a night measures the temperature effect. Least squares, standard error from the residuals. Needs {MIN_RUNS} runs on nights with two or more and a {MIN_RANGE_C} °C span in a night; the temperature is the focuser's sensor in whole degrees, the first run of a night often follows the tube cooling down.
			</p>
		{:else}
			<p class="muted">No successful auto focus run in the archived Autorun logs yet.</p>
		{/if}
	</Card>

	<Card title="V-curves">
		{#snippet accessory()}
			<select bind:value={() => shownNight, (v) => ((night = v), (selectedAt = null))} aria-label="Night">
				{#each nights as n (n)}<option value={n}>{nightLabel(n)}</option>{/each}
			</select>
		{/snippet}
		{#if selected}
			<div class="runs" role="group" aria-label="Auto focus runs">
				{#each nightRuns as r (r.at)}
					<button type="button" class:active={r === selected} class:failed={!r.success} onclick={() => (selectedAt = r.at)}>
						{clock(r.at * 1000)} <span class="num">{r.success ? r.position : 'failed'}</span>
					</button>
				{/each}
			</div>
			<XYChart
				series={curves}
				height={220}
				xFormat={(v) => v.toFixed(0)}
				yFormat={(v) => v.toFixed(1)}
				xLabel="EAF position"
				yLabel="star size"
				vlines={selected.position !== null ? [{ x: selected.position, color: 'var(--ok)', label: `focus ${selected.position}` }] : []}
				label="V-curve"
			/>
			<p class="small">
				<strong>{clock(selected.at * 1000)}</strong>
				{selected.target ?? ''}, {selected.reason ?? 'auto focus'}, {fixed(selected.temperatureC)} °C:
				{#if selected.success}focused at <span class="num">{selected.position}</span>, best star size {fixed(selected.bestSize, 1)}{:else}failed{selected.failure ? ` (${selected.failure})` : ''}{/if}
				· {Math.round(((selected.endedAt ?? selected.at) - selected.at) / 6) / 10} min
			</p>
			<p class="muted small">Line: the V-curve steps; grey dots: finding the focus star; green dots: the final approach; dashed: the fitted hyperbola{selectedFit ? ` (best ${Math.round(selectedFit.bestPos)}, minimum ${selectedFit.minSize.toFixed(1)}, ${TOLERANCE_PCT} % at ±${Math.round(selectedFit.toleranceSteps)} steps)` : ''}. Faint lines: the night's other runs. Star size is the ASIAIR's own measure (2 s frames).</p>
		{:else}
			<p class="muted">No V-curve for this night.</p>
		{/if}
	</Card>

	<Card title="HFR drift between auto focus runs">
		{#if drift.length}
			<XYChart
				series={driftSeries}
				height={200}
				xFormat={(v) => `${signed(v, 1)} °C`}
				yFormat={(v) => signed(v, 2)}
				xLabel="temperature change between the runs, °C"
				yLabel="HFR change, px"
				vlines={[{ x: 0, color: 'var(--border)' }]}
				label="HFR change against temperature change"
			/>
			<table>
				<thead><tr><th>Night</th><th>Between runs</th><th class="r">Frames</th><th class="r">°C</th><th class="r">Air</th><th class="r">HFR</th><th class="r">Predicted</th></tr></thead>
				<tbody>
					{#each drift as d (d.from.at)}
						<tr>
							<td>{nightLabel(d.night, false)}</td>
							<td class="num">{clock(d.from.at * 1000)}–{clock(d.to.at * 1000)}</td>
							<td class="r num">{d.frames}</td>
							<td class="r num">{d.from.temperatureC} → {d.to.temperatureC}</td>
							<td class="r num">{fixed(checked.get(d.from.at)?.airDeltaC, 1)}</td>
							<td class="r num">{d.hfrStart.toFixed(2)} → {d.hfrEnd.toFixed(2)}</td>
							<td class="r num">{checked.has(d.from.at) ? `+${checked.get(d.from.at)!.predictedPct.toFixed(0)} %` : '–'}</td>
						</tr>
					{/each}
				</tbody>
			</table>
			<p class="muted small">Per interval between two successful runs of a night with at least {DRIFT_MIN_FRAMES} frames: the median HFR (camera pixels) of the last {DRIFT_END_FRAMES} frames before the next run minus that of the first {DRIFT_END_FRAMES} after the run. Seeing and the target's altitude change the HFR too. <em>Air</em>: Open-Meteo's 2 m temperature change at the site over the interval; <em>Predicted</em>: the HFR growth the focuser's temperature change predicts at the coefficient on the first run's V-curve.</p>
		{:else}
			<p class="muted">No interval between two successful runs with frames yet.</p>
		{/if}
		{#if data.missing}<p class="warn small">{data.missing} session reports could not be read.</p>{/if}
	</Card>
</main>

<style>
	.page {
		display: grid;
		gap: var(--gap);
		grid-template-columns: minmax(0, 1fr);
	}
	@media (min-width: 1000px) {
		.page {
			grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
			align-items: start;
		}
		.page > :global(:nth-child(-n + 2)) {
			grid-column: 1 / -1;
		}
	}
	p {
		margin: 0;
	}
	.small {
		font-size: 13px;
	}
	.result strong {
		font-size: 20px;
		margin-right: 8px;
	}
	.advice {
		font-size: 15px;
		line-height: 1.45;
	}
	.facts {
		margin: 0;
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(min(100%, 220px), 1fr));
		gap: 8px 16px;
		font-size: 14px;
	}
	.facts dt {
		font-size: 12px;
		color: var(--muted);
	}
	.facts dd {
		margin: 0;
	}
	.warn {
		color: var(--warn);
	}
	.legend {
		display: flex;
		flex-wrap: wrap;
		gap: 4px 14px;
		font-size: 12px;
		color: var(--muted);
	}
	.legend i {
		display: inline-block;
		width: 9px;
		height: 9px;
		border-radius: 50%;
		margin-right: 5px;
	}
	.runs {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
	}
	.runs button {
		font: inherit;
		font-size: 12px;
		padding: 3px 9px;
		border-radius: 999px;
		border: 1px solid var(--border);
		background: none;
		color: var(--muted);
		cursor: pointer;
	}
	.runs button.active {
		background: var(--surface-strong);
		color: var(--text);
	}
	.runs button.failed {
		color: var(--bad);
	}
	select {
		font: inherit;
		font-size: 13px;
		background: var(--surface);
		color: var(--text);
		border: 1px solid var(--border);
		border-radius: 6px;
		padding: 2px 6px;
	}
	table {
		width: 100%;
		border-collapse: collapse;
		font-size: 13px;
	}
	th {
		text-align: left;
		font-size: 11px;
		font-weight: 600;
		color: var(--muted);
		padding: 3px 6px 3px 0;
	}
	td {
		padding: 3px 6px 3px 0;
		border-top: 1px solid var(--border);
	}
	.r {
		text-align: right;
	}
</style>
