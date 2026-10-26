<script lang="ts">
	import Card from '$lib/components/Card.svelte';
	import CloudCompare from '$lib/components/CloudCompare.svelte';
	import { clock, nightLabel } from '$lib/format';
	import { BACKGROUND_RATIO, CLEAR_RATIO, CLOUDY_RATIO, DARK_SUN_DEG, MIN_HOUR_EXPOSURE_S, REFERENCE_PERCENTILE, rank } from '$lib/forecasts';
	import { LOW_ALTITUDE } from '$lib/sky';
	import type { ForecastLead, ModelScore } from '$lib/types';

	/**
	 * C4: which model has been right at the cabin. Per hour of every session, the cloud the frames saw against
	 * each model's forecast (the run current a day before, or the latest run before the hour); a leaderboard
	 * over all judged hours and the scores per session.
	 */
	let { data } = $props();

	const report = $derived(data.report);
	let lead = $state<ForecastLead>('dayAhead');
	const LEADS: [ForecastLead, string][] = [
		['dayAhead', 'Day ahead'],
		['latest', 'Latest run']
	];
	const other = $derived<ForecastLead>(lead === 'dayAhead' ? 'latest' : 'dayAhead');
	const board = $derived(report ? rank(report.leaderboard[lead]) : []);
	const otherById = $derived(new Map((report?.leaderboard[other] ?? []).map((s) => [s.id, s])));
	const scored = $derived((report?.sessions ?? []).filter((s) => !s.excluded));
	const excluded = $derived((report?.sessions ?? []).filter((s) => s.excluded));
	const judgedHours = $derived(scored.reduce((n, s) => n + s.hours.filter((h) => h.observed !== null).length, 0));
	const cloudyHours = $derived(report ? scored.reduce((n, s) => n + s.hours.filter((h) => h.observed !== null && h.observed > report.clearPct).length, 0) : 0);
	const pct = (v: number | null) => (v === null ? '–' : `${Math.round(100 * v)} %`);
	const pp = (v: number | null, signed = false) => (v === null ? '–' : `${signed && v > 0 ? '+' : ''}${v.toFixed(0)}`);
	const best = (scores: ModelScore[]) => scores.find((s) => s.hours > 0) ?? null;
</script>

<svelte:head><title>Forecasts · Stats · Telescope</title></svelte:head>

<main>
	{#if !report}
		<Card><p class="muted">No site configured (TELESCOPE_SITE).</p></Card>
	{:else}
		<Card title="Which forecast was right">
			{#snippet accessory()}
				<div class="chips">
					{#each LEADS as [value, label] (value)}
						<button class="btn" class:on={lead === value} onclick={() => (lead = value)}>{label}</button>
					{/each}
				</div>
			{/snippet}
			<p class="small muted">{judgedHours} hours judged in {scored.length} sessions ({cloudyHours} of them cloudy in the frames). {lead === 'dayAhead' ? 'The forecast as it stood 24 h before each hour' : 'The latest run before each hour (a few hours ahead)'}; the other in grey.</p>
			<table>
				<thead>
					<tr><th>Model</th><th>Hours</th><th title="Clear/cloudy call at {report.clearPct} % matched the frames">Hit rate</th><th title="Mean absolute error, percentage points">Error</th><th title="Mean forecast − seen, percentage points: + too cloudy, − too clear">Bias</th></tr>
				</thead>
				<tbody>
					{#each board as s, i (s.id)}
						{@const o = otherById.get(s.id)}
						<tr class:lead={i === 0 && s.hours > 0}>
							<td>{s.label}</td>
							<td class="num">{s.hours}</td>
							<td class="num">{pct(s.hitRate)} <span class="faint">{pct(o?.hitRate ?? null)}</span></td>
							<td class="num">{pp(s.mae)} <span class="faint">{pp(o?.mae ?? null)}</span></td>
							<td class="num">{pp(s.bias, true)} <span class="faint">{pp(o?.bias ?? null, true)}</span></td>
						</tr>
					{/each}
				</tbody>
			</table>
			<p class="small muted">
				Hit rate: the clear/cloudy call (≤ {report.clearPct} %, the Conditions page's line) agreed with the frames. Error and bias in percentage points (+ forecast too cloudy). Open-Meteo's previous-runs API at the site: <code>cloud_cover_previous_day1</code> (day ahead; no low/mid/high for it) and <code>cloud_cover</code> with low/mid/high (latest run, as the historical forecast API stitches it).
			</p>
			<details class="small muted">
				<summary>How the frames judge the sky, and the limits</summary>
				<p>
					A frame's stars against the session's clear reference (the {Math.round(REFERENCE_PERCENTILE * 100)}th percentile of its judged frames): at or above {Math.round(CLEAR_RATIO * 100)} % clear, below {Math.round(CLOUDY_RATIO * 100)} % cloudy, partly in between;
					also cloudy when the service rejected it for few stars, or its background is {BACKGROUND_RATIO}× the session's median with stars under {Math.round(CLEAR_RATIO * 100)} %. An hour (frames within ±30 min of the hour mark) is the exposure-weighted mean and needs {MIN_HOUR_EXPOSURE_S / 60} min of judged frames.
					Not judged: frames with the sun above {DARK_SUN_DEG}° (twilight dims the stars), the target under {LOW_ALTITUDE}° (trees), frames rejected first for HFR, trailing or guiding, and Live stacking sessions.
				</p>
				<p>
					Only hours with frames have a truth: nights not imaged because the forecast said cloud never count, so a model that cries cloud is not punished for it here. The truth is relative: a session hazy from start to end looks clear, and dew on the lens, a tree or the cabin roof dim stars like cloud (a slow steady fade over hours with an unchanged background, as on 2026-10-17, is more likely dew or thin high cloud). Star counts also fall a little as the target sinks.
					Few sessions so far: a few hours more or less move the rates by several points.
				</p>
			</details>
		</Card>

		{#each scored as s (s.id)}
			{@const top = best(s.scores[lead])}
			<Card title="{s.target} · {nightLabel(s.night)}">
				{#snippet accessory()}<a href="/sessions/{s.id}">Report</a>{/snippet}
				<CloudCompare hours={s.hours} models={report.models} {lead} clearPct={report.clearPct} />
				<p class="small muted">
					{clock(s.firstFrameAt * 1000)}–{clock(s.lastFrameAt * 1000)} · {s.judgedFrames} frames judged, reference {s.referenceStars} stars · {s.hours.filter((h) => h.observed !== null).length} hours judged{#if top}; best: {top.label} ({pct(top.hitRate)}, error {pp(top.mae)}){/if}
				</p>
				<div class="scores small">
					{#each s.scores[lead] as m (m.id)}
						<span><strong>{m.label}</strong> {pct(m.hitRate)} · {pp(m.mae)} · {pp(m.bias, true)}</span>
					{/each}
				</div>
				{#if s.forecastError}<p class="small warn">Forecasts unavailable: {s.forecastError}</p>{/if}
			</Card>
		{/each}

		{#if excluded.length}
			<Card title="Not judged">
				<ul class="small">
					{#each excluded as s (s.id)}
						<li><a href="/sessions/{s.id}">{s.target} · {nightLabel(s.night)}</a> <span class="muted">{s.excluded}</span></li>
					{/each}
				</ul>
			</Card>
		{/if}
	{/if}
</main>

<style>
	main {
		display: flex;
		flex-direction: column;
		gap: var(--gap);
	}
	p {
		margin: 0;
	}
	.small {
		font-size: 12px;
	}
	details p {
		margin-top: 6px;
	}
	summary {
		cursor: pointer;
	}
	.chips {
		display: flex;
		gap: 4px;
	}
	table {
		width: 100%;
		border-collapse: collapse;
		font-size: 14px;
	}
	th {
		text-align: left;
		font-weight: 500;
		font-size: 12px;
		color: var(--muted);
		padding: 0 8px 6px 0;
	}
	td {
		padding: 5px 8px 5px 0;
		border-top: 1px solid var(--border);
	}
	td.num,
	th:not(:first-child) {
		text-align: right;
	}
	tr.lead td {
		font-weight: 650;
	}
	.scores {
		display: flex;
		flex-wrap: wrap;
		gap: 4px 16px;
		color: var(--muted);
	}
	.scores strong {
		font-weight: 600;
		color: var(--text);
	}
	ul {
		margin: 0;
		padding-left: 18px;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
</style>
