<script lang="ts">
	import Card from '$lib/components/Card.svelte';
	import TimeChart, { type ChartSeries } from '$lib/components/TimeChart.svelte';
	import XYChart, { type XYSeries } from '$lib/components/XYChart.svelte';
	import { clock, fixed, formatDuration, nightLabel } from '$lib/format';
	import { NIGHT_COLORS } from '$lib/focus';
	import type { GuideCorrections } from '$lib/types';

	/**
	 * D7: the mount from the PHD2 guide logs: every log's RMS, and for one log its guiding sections, RA/Dec errors,
	 * the reconstructed RA periodic error with its periodogram, the Dec drift with the polar alignment error it
	 * implies, a Dec backlash estimate and the correction statistics.
	 */
	let { data } = $props();

	const logs = $derived(data.logs);
	const log = $derived(data.log);
	/** Sections shorter than this are left out of the RMS-over-time chart (a few steps between stops). */
	const RMS_MIN_SECTION_S = 600;

	const rmsSeries = $derived<XYSeries[]>(
		[...logs].reverse().map((g, i) => {
			const rows = g.sectionRms.filter(([, d, rms]) => d >= RMS_MIN_SECTION_S && rms !== null);
			return {
				points: rows.map(([at, , rms]) => [at, rms] as [number, number]),
				color: NIGHT_COLORS[i % NIGHT_COLORS.length],
				kind: 'dots',
				radius: 3.2,
				title: (j: number) => `${nightLabel(g.night ?? '')} ${clock(rows[j][0] * 1000)}: ${rows[j][2]}″ over ${formatDuration(rows[j][1])}`
			};
		})
	);

	const from = $derived(log?.series[0]?.[0] ?? 0);
	const to = $derived(log?.series.at(-1)?.[0] ?? 1);
	const errors = $derived<ChartSeries[]>(
		log
			? [
					{ points: log.series.map(([t, ra]) => [t, ra]), color: 'var(--ra)', width: 1 },
					{ points: log.series.map(([t, , dec]) => [t, dec]), color: 'var(--dec)', width: 1 }
				]
			: []
	);
	const sectionMarks = $derived((log?.guidingSections ?? []).map((s) => ({ at: s.startedAt, color: 'var(--border)' })));
	const peCurve = $derived<ChartSeries[]>(
		log?.pe
			? [
					{ points: log.pe.curve.map(([t, v]) => [t, v]), color: 'var(--faint)', kind: 'dots', radius: () => 1.2 },
					{ points: log.pe.curve.map(([t, , s]) => [t, s]), color: 'var(--line1)', width: 1.5 }
				]
			: []
	);
	const peFrom = $derived(log?.pe?.curve[0]?.[0] ?? 0);
	const peTo = $derived(log?.pe?.curve.at(-1)?.[0] ?? 1);
	/** The worm's own error is the error on the sky ÷ cos Dec (same ratio as the peak-to-peak values). */
	const axisRatio = $derived(log?.pe?.peakToPeakAxisArcsec && log.pe.peakToPeakArcsec ? log.pe.peakToPeakAxisArcsec / log.pe.peakToPeakArcsec : null);
</script>

{#snippet corrRow(axis: string, c: GuideCorrections, plus: string, minus: string)}
	<tr>
		<td>{axis}</td>
		<td class="r num">{c.share === null ? '–' : `${Math.round(c.share * 100)} %`}</td>
		<td class="r num">{fixed(c.meanMs)}</td>
		<td class="r num">{fixed(c.maxMs)}</td>
		<td class="r num">{c.positive} {plus} / {c.negative} {minus}</td>
	</tr>
{/snippet}

<svelte:head><title>Mount · Stats · Telescope</title></svelte:head>

<main class="page">
	<Card title="PHD2 guide logs">
		{#if logs.length}
			<table>
				<thead><tr><th>Night</th><th class="r">Sections</th><th class="r">Guiding</th><th class="r">RA ″</th><th class="r">Dec ″</th><th class="r">Total ″</th></tr></thead>
				<tbody>
					{#each logs as g (g.id)}
						<tr class:active={g.id === log?.id}>
							<td><a href="?log={encodeURIComponent(g.id)}">{nightLabel(g.night ?? '')}</a></td>
							<td class="r num">{g.sections}</td>
							<td class="r num">{formatDuration(g.guidingS)}</td>
							<td class="r num">{fixed(g.rmsArcsec.ra, 2)}</td>
							<td class="r num">{fixed(g.rmsArcsec.dec, 2)}</td>
							<td class="r num">{fixed(g.rmsArcsec.total, 2)}</td>
						</tr>
					{/each}
				</tbody>
			</table>
			<p class="muted small">RMS as PHD2 counts it (spread around the mean) over every steady step: no settling, no lost star, no outlier (a step over 10″, another star measured for a frame). Logs exist only for nights where the ASIAIR wrote one to its share.</p>
		{:else}
			<p class="muted">No PHD2 guide log in the archive.</p>
		{/if}
	</Card>

	{#if logs.length}
		<Card title="Guiding RMS over time">
			<XYChart series={rmsSeries} height={170} xFormat={(s) => new Date(s * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' })} yFormat={(v) => v.toFixed(1)} yMin={0} yLabel="total RMS ″" label="Guiding RMS per section across nights" />
			<p class="muted small">One dot per guiding section of at least {RMS_MIN_SECTION_S / 60} min, coloured by night (the ASIAIR stops guiding for every auto focus and flip).</p>
		</Card>
	{/if}

	{#if log}
		<div class="wide"><Card title="Guiding on {nightLabel(log.night ?? '')}">
			{#snippet accessory()}<span class="num muted">{log.mount ?? 'mount'} · {fixed(log.pixelScaleArcsec, 2)}″/px · {formatDuration(log.guidingS)}</span>{/snippet}
			<span class="plabel"><i class="key ra"></i>RA <i class="key dec"></i>Dec error, ″ (every measured step)</span>
			<TimeChart {from} {to} height={130} series={errors} symmetric gapS={60} marks={sectionMarks} label="RA and Dec guiding error" />
			<div class="scroll">
				<table>
					<thead>
						<tr><th>#</th><th>Start</th><th class="r">Length</th><th>Pier</th><th class="r">Dec</th><th class="r">HA h</th><th class="r">Steps</th><th class="r">Lost</th><th class="r">Excl.</th><th class="r">RMS RA/Dec/total ″</th><th class="r">Peak RA/Dec ″</th><th class="r">Dec drift ″/min</th><th class="r">PE p-p ″</th></tr>
					</thead>
					<tbody>
						{#each log.guidingSections as s (s.index)}
							<tr>
								<td class="num">{s.index}</td>
								<td class="num">{clock(s.startedAt * 1000)}</td>
								<td class="r num">{formatDuration(s.durationS)}</td>
								<td>{s.pierSide ?? '–'}</td>
								<td class="r num">{fixed(s.decDeg, 1)}°</td>
								<td class="r num">{fixed(s.hourAngleH, 2)}</td>
								<td class="r num">{s.steps}</td>
								<td class="r num">{s.lost}{s.outliers ? ` +${s.outliers}` : ''}</td>
								<td class="r num">{s.settling + s.dithered}</td>
								<td class="r num">{fixed(s.rmsArcsec.ra, 2)} / {fixed(s.rmsArcsec.dec, 2)} / {fixed(s.rmsArcsec.total, 2)}</td>
								<td class="r num">{fixed(s.peakArcsec.ra, 1)} / {fixed(s.peakArcsec.dec, 1)}</td>
								<td class="r num">{s.decDrift ? fixed(s.decDrift.arcsecPerMin, 2) : '–'}</td>
								<td class="r num">{s.pe ? fixed(s.pe.peakToPeakArcsec, 1) : '–'}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
			<p class="muted small">Lost: frames without a star (+ outliers over 10″). Excl.: steps while settling or after a dither (the ASIAIR's PHD2 logs no dithers). Dec and hour angle at the section's start; drift from sections of 10 min or more, periodic error from 40 min, both only with under 2 % of the steps lost.</p>
		</Card></div>

		<div class="wide"><Card title="Periodic error (RA)">
			{#snippet accessory()}{#if log.pe}<span class="num muted">{log.pe.sections} section{log.pe.sections === 1 ? '' : 's'} ≥ {log.pe.minSectionS / 60} min</span>{/if}{/snippet}
			{#if log.pe}
				<p class="result">
					<strong class="num">{fixed(log.pe.peakToPeakArcsec, 1)}″ peak to peak</strong>
					<span class="muted">on the sky{#if log.pe.peakToPeakAxisArcsec !== null}, {fixed(log.pe.peakToPeakAxisArcsec, 1)}″ at the RA axis (÷ cos Dec){/if}</span>
				</p>
				<span class="plabel">Reconstructed RA position without guiding, drift removed, ″ (dots: every step; line: 30 s mean)</span>
				<TimeChart from={peFrom} to={peTo} height={130} series={peCurve} symmetric gapS={60} label="Reconstructed periodic error" />
				<div class="two">
					<div>
						<span class="plabel">Periodogram: amplitude of a sine per period, ″ on the sky</span>
						<XYChart
							series={[{ points: log.pe.periodogram, color: 'var(--line1)', kind: 'line' }]}
							height={170}
							xMin={log.pe.periodRangeS[0]}
							xMax={log.pe.periodRangeS[1]}
							yMin={0}
							xFormat={(v) => `${Math.round(v)} s`}
							yFormat={(v) => v.toFixed(1)}
							xLabel="period, s"
							vlines={log.pe.periods.slice(0, 3).map((p) => ({ x: p.periodS, color: 'var(--accent)', label: `${Math.round(p.periodS)} s`, dash: true }))}
							label="Periodogram of the RA error"
						/>
					</div>
					<table>
						<thead><tr><th class="r">Period</th><th class="r">s</th><th class="r">Amplitude ″</th>{#if axisRatio}<th class="r">at axis ″</th>{/if}</tr></thead>
						<tbody>
							{#each log.pe.periods as p (p.periodS)}
								<tr>
									<td class="r num">{Math.floor(p.periodS / 60)}:{String(Math.round(p.periodS % 60)).padStart(2, '0')}</td>
									<td class="r num">{p.periodS.toFixed(0)}</td>
									<td class="r num">{p.amplitudeArcsec.toFixed(2)}</td>
									{#if axisRatio}<td class="r num">{(p.amplitudeArcsec * axisRatio).toFixed(1)}</td>{/if}
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
				<p class="muted small">
					The uncorrected RA position at each step is PHD2's measured error plus every correction sent before it (the guide distance, or what the pulse could move when Max duration cut it); a straight line (drift, polar alignment, refraction) is removed per section. Amplitudes: a least-squares sine per period (a Lomb–Scargle periodogram in arcseconds, uneven steps and lost stars allowed), averaged over the sections weighted by length; peaks refined between grid points. Periods {log.pe.periodRangeS[0]}–{log.pe.periodRangeS[1]} s; a section must last {log.pe.minSectionS / 60} min (two cycles of the longest period) to be used. No mount model is assumed; the strongest periods are listed. The peak to peak includes slow wander that is not periodic.
				</p>
			{:else}
				<p class="muted">No section long enough and clean enough: the periodic error needs 40 min of guiding without a stop (two cycles of the longest period searched, 1200 s) and under 2 % of the steps lost.</p>
			{/if}
		</Card></div>

		<Card title="Dec drift and polar alignment">
			{#if log.decDrift}
				<p class="result">
					<strong class="num">≥ {fixed(log.decDrift.polarErrorArcmin, 1)}′</strong>
					<span class="muted">polar alignment error, from the strongest drift {fixed(log.decDrift.maxArcsecPerMin, 2)}″/min ({log.decDrift.sections} sections)</span>
				</p>
				<table>
					<thead><tr><th>#</th><th>Pier</th><th class="r">HA h</th><th class="r">Drift ″/min</th><th class="r">Error ≥ ′</th></tr></thead>
					<tbody>
						{#each log.guidingSections.filter((s) => s.decDrift) as s (s.index)}
							<tr><td class="num">{s.index}</td><td>{s.pierSide ?? '–'}</td><td class="r num">{fixed(s.hourAngleH, 2)}</td><td class="r num">{fixed(s.decDrift!.arcsecPerMin, 2)}</td><td class="r num">{fixed(s.decDrift!.polarErrorArcmin, 1)}</td></tr>
						{/each}
					</tbody>
				</table>
				<p class="muted small">
					The uncorrected Dec position (as for RA: error plus corrections sent), a straight line per section of 10 min or more. A polar axis off by ε moves a star in Dec at ε·ω·|sin(H − H₀)| (ω the sidereal rate, 0.004375 rad/min), so the drift gives a lower bound: ε ≥ drift / ω, i.e. ε (′) ≥ 3.81 × drift (″/min). The full error would need drifts at several hour angles; PHD2's Guiding Assistant also divides by cos Dec. The sign flips with the pier side.
				</p>
			{:else}
				<p class="muted">No section of 10 min or more with under 2 % of the steps lost.</p>
			{/if}
		</Card>

		<Card title="Dec backlash (estimate)">
			{#if log.backlash}
				{@const b = log.backlash}
				<p class="result">
					{#if b.estimateMs !== null}
						<strong class="num">≈ {fixed(b.estimateMs)} ms</strong>
						<span class="muted">{#if b.estimateArcsec !== null}≈ {fixed(b.estimateArcsec, 2)}″ of Dec pulses lost after a reversal{/if}</span>
					{:else}
						<strong>Too few reversals to tell</strong>
					{/if}
				</p>
				<dl>
					<div><dt>Reversals measured</dt><dd class="num">{b.measured} of {b.reversals}{b.unanswered ? ` (${b.unanswered} without a response in 20 steps)` : ''}</dd></div>
					<div><dt>Until the error responds, after a reversal</dt><dd class="num">{fixed(b.reversalMs)} ms, {fixed(b.reversalPulses, 0)} pulse{b.reversalPulses === 1 ? '' : 's'} (median)</dd></div>
					<div><dt>The same after a pulse the same way</dt><dd class="num">{fixed(b.sameWayMs)} ms, {fixed(b.sameWayPulses, 0)} pulse{b.sameWayPulses === 1 ? '' : 's'} ({b.sameWay} pulses)</dd></div>
				</dl>
				<p class="muted small">
					For every Dec pulse: the pulse time sent in that direction until the Dec error has moved back by half the first pulse's distance (up to 20 steps; a pulse the other way first ends it unmeasured). After a reversal the gears must first take up the play; after a pulse the same way they need not. The estimate is the difference of the two medians, so seeing, drift and the measuring rule cancel to first order. It is an estimate from guiding data, not a backlash test (PHD2's Guiding Assistant measures with long pulses).
				</p>
			{:else}
				<p class="muted">No Dec pulses in this log.</p>
			{/if}
		</Card>

		<Card title="Corrections">
			<table>
				<thead><tr><th>Axis</th><th class="r">Steps with a pulse</th><th class="r">Mean ms</th><th class="r">Max ms</th><th class="r">Directions</th></tr></thead>
				<tbody>
					{@render corrRow('RA', log.corrections.ra, 'W', 'E')}
					{@render corrRow('Dec', log.corrections.dec, '+', '−')}
				</tbody>
			</table>
			<p class="muted small">Steady steps only. Dec: + is the direction PHD2 sends for a positive error (north or south depending on the calibration and pier side). A strong imbalance means a steady drift the guider keeps pushing against.</p>
		</Card>
	{:else if logs.length}
		<Card><p class="warn">The guide log could not be analysed (telescope service unavailable).</p></Card>
	{/if}
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
		.wide {
			grid-column: 1 / -1;
		}
	}
	p {
		margin: 0;
	}
	.small {
		font-size: 13px;
	}
	.warn {
		color: var(--warn);
	}
	.result strong {
		font-size: 20px;
		margin-right: 8px;
	}
	.plabel {
		display: block;
		font-size: 11px;
		color: var(--faint);
		margin-top: 4px;
	}
	.key {
		display: inline-block;
		width: 12px;
		border-top: 2px solid;
		margin: 0 3px 2px 6px;
		vertical-align: middle;
	}
	.key.ra {
		border-color: var(--ra);
	}
	.key.dec {
		border-color: var(--dec);
	}
	.two {
		display: grid;
		gap: 12px;
		grid-template-columns: minmax(0, 2fr) minmax(0, 1fr);
		align-items: start;
	}
	@media (max-width: 640px) {
		.two {
			grid-template-columns: minmax(0, 1fr);
		}
	}
	.scroll {
		overflow-x: auto;
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
		padding: 3px 8px 3px 0;
		white-space: nowrap;
	}
	td {
		padding: 3px 8px 3px 0;
		border-top: 1px solid var(--border);
		white-space: nowrap;
	}
	tr.active td {
		background: var(--surface-strong);
	}
	.r {
		text-align: right;
	}
	dl {
		margin: 0;
		display: grid;
		gap: 6px;
	}
	dt {
		font-size: 12px;
		color: var(--muted);
	}
	dd {
		margin: 1px 0 0;
		font-size: 14px;
	}
</style>
