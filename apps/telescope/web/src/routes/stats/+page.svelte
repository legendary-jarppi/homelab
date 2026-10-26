<script lang="ts">
	import Card from '$lib/components/Card.svelte';
	import MonthBars from '$lib/components/MonthBars.svelte';
	import TrendChart from '$lib/components/TrendChart.svelte';
	import { getMoonIllumination } from 'suncalc';
	import { arcsec, fixed, formatDuration, nightLabel } from '$lib/format';
	import { progressByTarget } from '$lib/goals';
	import { moonAltitude } from '$lib/sky';
	import { byPeriod, monthOf, monthsBetween, rejectionBreakdown, seasonOf, type PeriodRow } from '$lib/stats';

	/**
	 * D6: hours per month, season and year, acceptance and rejection reasons, per-target totals, clear nights
	 * (ERA5) against the nights imaged, and guiding and star size over time.
	 */
	let { data } = $props();

	const sessions = $derived(data.sessions);
	const totals = $derived.by(() => {
		const sum = (f: (s: (typeof sessions)[number]) => number) => sessions.reduce((n, s) => n + f(s), 0);
		const accepted = sum((s) => s.accepted);
		const rejected = sum((s) => s.rejected);
		return {
			acceptedS: sum((s) => s.integrationS),
			rejectedS: sum((s) => s.rejectedS ?? 0),
			frames: sum((s) => s.frames),
			accepted,
			rejected,
			nights: new Set(sessions.map((s) => s.night)).size
		};
	});
	const thisMonth = monthOf(new Date().toLocaleDateString('sv-SE'));
	const months = $derived(sessions.length ? monthsBetween(monthOf(sessions.reduce((min, s) => (s.night < min ? s.night : min), sessions[0].night)), thisMonth) : []);
	const perMonth = $derived(new Map(byPeriod(sessions, (s) => ({ key: monthOf(s.night), label: monthOf(s.night) })).map((r) => [r.key, r])));
	const seasons = $derived(byPeriod(sessions, (s) => seasonOf(s.night)).reverse());
	const years = $derived(byPeriod(sessions, (s) => ({ key: s.night.slice(0, 4), label: s.night.slice(0, 4) })).reverse());
	const reasons = $derived(rejectionBreakdown(sessions));
	const targets = $derived(progressByTarget(sessions, {}));
	const hours = (s: number) => `${(s / 3600).toFixed(1)} h`;
	const share = (part: number, whole: number) => (whole ? `${Math.round((100 * part) / whole)} %` : '–');

	const clear = $derived(data.clear);
	const clearTotals = $derived.by(() => {
		const rows = clear?.months ?? [];
		const sum = (f: (r: (typeof rows)[number]) => number) => rows.reduce((n, r) => n + f(r), 0);
		return { known: sum((r) => r.known), clear: sum((r) => r.clear), imaged: sum((r) => r.clearImaged), missed: sum((r) => r.clearMissed), notClear: sum((r) => r.imagedNotClear) };
	});

	const guiding = $derived([
		{
			label: 'Sessions (live history)',
			color: 'var(--line1)',
			points: sessions
				.filter((s) => s.guidingRmsArcsec !== null && s.guidingRmsArcsec !== undefined)
				.map((s) => ({ at: s.firstFrameAt, value: s.guidingRmsArcsec as number, title: `${nightLabel(s.night)} ${s.target}: ${arcsec(s.guidingRmsArcsec)}″`, href: `/sessions/${s.id}` }))
		},
		{
			label: 'PHD2 guide logs',
			color: 'var(--line2)',
			points: (data.guideLogs ?? []).flatMap((g) =>
				g.rmsArcsec.total === null || g.startedAt === null
					? []
					: [{ at: g.startedAt, value: g.rmsArcsec.total, title: `${g.night ? nightLabel(g.night) : g.id}: ${arcsec(g.rmsArcsec.total)}″ (PHD2 log)` }]
			)
		}
	]);
	const starSize = $derived(
		(
			[
				['HFR', 'hfr', 'var(--line3)'],
				['FWHM', 'fwhmPx', 'var(--line4)']
			] as const
		).map(([label, key, color]) => ({
			label: `${label} (px)`,
			color,
			points: sessions
				.filter((s) => s[key] !== null && s[key] !== undefined)
				.map((s) => ({ at: s.firstFrameAt, value: s[key] as number, title: `${nightLabel(s.night)} ${s.target}: ${label} ${fixed(s[key], 2)} px`, href: `/sessions/${s.id}` }))
		}))
	);
	/** R6: each session's median sky brightness with the moon at its middle (illumination, and up or down at the site). */
	const skyRows = $derived(
		sessions
			.filter((s) => s.skyMag !== null && s.skyMag !== undefined)
			.map((s) => {
				const mid = ((s.firstFrameAt + s.lastFrameAt) / 2) * 1000;
				return { s, moonPct: Math.round(getMoonIllumination(new Date(mid)).fraction * 100), moonUp: data.site ? moonAltitude(data.site.lat, data.site.lon, mid) > 0 : null };
			})
	);
	const skySeries = $derived(
		(
			[
				['Moon up', true, 'var(--line4)'],
				['Moon down', false, 'var(--line1)'],
				['Moon not known', null, 'var(--line2)']
			] as const
		)
			.map(([label, up, color]) => ({
				label,
				color,
				points: skyRows
					.filter((r) => r.moonUp === up)
					.map((r) => ({ at: r.s.firstFrameAt, value: r.s.skyMag as number, title: `${nightLabel(r.s.night)} ${r.s.target}: ${fixed(r.s.skyMag, 2)} mag/″², moon ${r.moonPct} % lit${up === null ? '' : up ? ', up' : ', down'}, ${r.s.filter ?? 'no filter'}`, href: `/sessions/${r.s.id}` }))
			}))
			.filter((series) => series.points.length)
	);
	// Zero points compare only through the same filter: the newest session's train.
	const currentFilter = $derived(skyRows[0]?.s.filter ?? null);
	const bestZp = $derived(Math.max(...skyRows.filter((r) => (r.s.filter ?? null) === currentFilter).map((r) => r.s.zeroPoint ?? -Infinity)));
</script>

<svelte:head><title>Stats · Telescope</title></svelte:head>

{#snippet periodTable(rows: PeriodRow[], first: string)}
	<table>
		<thead><tr><th>{first}</th><th>Accepted</th><th>Rejected</th><th>Nights</th><th>Sessions</th><th>Frames</th><th>Accepted</th></tr></thead>
		<tbody>
			{#each rows as r (r.key)}
				<tr><td>{r.label}</td><td class="num">{hours(r.acceptedS)}</td><td class="num">{hours(r.rejectedS)}</td><td class="num">{r.nights}</td><td class="num">{r.sessions}</td><td class="num">{r.frames}</td><td class="num">{share(r.accepted, r.accepted + r.rejected)}</td></tr>
			{/each}
		</tbody>
	</table>
{/snippet}

<main>
	{#if sessions.length === 0}
		<Card><p class="muted">No sessions yet.</p></Card>
	{:else}
		<Card title="Overview">
			<dl class="facts">
				<div><dt>Integration</dt><dd class="num">{formatDuration(totals.acceptedS)}</dd></div>
				<div><dt>Rejected</dt><dd class="num">{formatDuration(totals.rejectedS)}</dd></div>
				<div><dt>Nights imaged</dt><dd class="num">{totals.nights}</dd></div>
				<div><dt>Sessions</dt><dd class="num">{sessions.length}</dd></div>
				<div><dt>Frames</dt><dd class="num">{totals.frames}</dd></div>
				<div><dt>Accepted</dt><dd class="num">{share(totals.accepted, totals.accepted + totals.rejected)}</dd></div>
				<div><dt>Targets</dt><dd class="num">{targets.length}</dd></div>
				{#if clear && clearTotals.clear}<div><dt>Clear nights imaged</dt><dd class="num">{clearTotals.imaged} / {clearTotals.clear}</dd></div>{/if}
			</dl>
		</Card>

		<div class="grid">
			<Card title="Hours per month">
				<MonthBars
					{months}
					label="Accepted and rejected hours per month"
					format={(v) => v.toFixed(v >= 10 || v === 0 ? 0 : 1)}
					stacks={[
						{ label: 'Accepted h', color: 'var(--line1)', values: months.map((m) => (perMonth.get(m)?.acceptedS ?? 0) / 3600) },
						{ label: 'Rejected h', color: 'var(--line4)', values: months.map((m) => (perMonth.get(m)?.rejectedS ?? 0) / 3600) }
					]}
				/>
			</Card>

			<Card title="Clear nights">
				{#if !clear}
					<p class="muted small">No site configured (TELESCOPE_SITE).</p>
				{:else if clear.error && !clear.nights.length}
					<p class="small warn">ERA5 unavailable: {clear.error}</p>
				{:else}
					<MonthBars
						months={clear.months.map((r) => r.month)}
						label="Clear nights per month, imaged and missed"
						stacks={[
							{ label: 'Clear, imaged', color: 'var(--line1)', values: clear.months.map((r) => r.clearImaged) },
							{ label: 'Clear, missed', color: 'var(--line4)', values: clear.months.map((r) => r.clearMissed) },
							{ label: 'Imaged, not clear', color: 'var(--line2)', values: clear.months.map((r) => r.imagedNotClear) }
						]}
					/>
					<p class="small muted">
						A night is clear with at least {data.clearNightHours} hours of cloud ≤ {data.clearPct} % during darkness (astronomical, else nautical; the light nights of May–July have none), or half its darkness when that is shorter, in ERA5 at the site (reanalysis, ~28 km grid, hourly).
						ERA5 runs about six days behind{#if clear.until}: known until {new Date(clear.until * 1000).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}{/if}; later nights are not counted yet.
						{clearTotals.known} dark nights known, {clearTotals.clear} clear, {clearTotals.imaged} imaged ({share(clearTotals.imaged, clearTotals.clear)}), {clearTotals.missed} missed{clearTotals.notClear ? `; ${clearTotals.notClear} imaged on nights ERA5 calls not clear` : ''}.
					</p>
					{#if clear.error}<p class="small warn">ERA5 refresh failed: {clear.error}</p>{/if}
				{/if}
			</Card>

			<Card title="By season">
				{@render periodTable(seasons, 'Season')}
			</Card>

			<Card title="By year">
				{@render periodTable(years, 'Year')}
				<p class="small muted">Hours of accepted and rejected exposure; nights by the evening's date. Seasons: winter Dec–Feb, spring Mar–May, summer Jun–Aug, autumn Sep–Nov.</p>
			</Card>

			<Card title="Rejections">
				{#if reasons.length === 0}
					<p class="muted small">No rejected frames{sessions.some((s) => s.rejectReasons === undefined) ? ' counted (the service does not report reasons yet)' : ''}.</p>
				{:else}
					{@const most = reasons[0].frames}
					<ul class="bars">
						{#each reasons as r (r.kind)}
							<li>
								<span>{r.label}</span>
								<span class="bar"><i style:width="{(100 * r.frames) / most}%"></i></span>
								<span class="num">{r.frames} · {share(r.frames, totals.rejected)}</span>
							</li>
						{/each}
					</ul>
					<p class="small muted">{totals.rejected} of {totals.accepted + totals.rejected} analysed frames rejected, each counted by its first reason (a frame of clouds often also has a bright background).</p>
				{/if}
			</Card>

			<Card title="Guiding over time">
				{#if guiding.every((s) => s.points.length === 0)}
					<p class="muted small">No guiding recorded yet.</p>
				{:else}
					<TrendChart series={guiding} label="Guiding RMS per session, arcsec" yFormat={(v) => `${v.toFixed(1)}″`} />
				{/if}
				<p class="small muted">
					Total RMS (RA and Dec) in arcsec: per session from the live history (the frames' guiding during their exposures), recorded since 2026-10-19; per guide run from the PHD2 logs at the end of a night{data.guideLogs === null ? ' (not available from the service)' : ''}. Under 1″ is good at the camera's 1.16″/px.
				</p>
			</Card>

			<Card title="Star size over time">
				<TrendChart series={starSize} label="Median HFR and FWHM per session, pixels" />
				<p class="small muted">Medians of each session's accepted frames, in camera pixels (1.16″/px): focus, seeing and guiding together.</p>
			</Card>

			<Card title="Sky brightness">
				{#if skyRows.length === 0}
					<p class="muted small">Not measured yet: the service measures each plate-solved frame once it has read noise from archived bias frames.</p>
				{:else}
					<TrendChart series={skySeries} label="Median sky brightness per session, mag/arcsec²" yFormat={(v) => v.toFixed(1)} fromZero={false} />
					<table>
						<thead><tr><th>Night</th><th>Target</th><th>Sky mag/″²</th><th>Zero point</th><th>Moon</th><th>Filter</th></tr></thead>
						<tbody>
							{#each skyRows as r (r.s.id)}
								<tr>
									<td><a href="/sessions/{r.s.id}">{nightLabel(r.s.night, false)}</a></td>
									<td>{r.s.target}</td>
									<td class="num">{fixed(r.s.skyMag, 2)}</td>
									<td class="num">{fixed(r.s.zeroPoint, 2)}</td>
									<td class="num">{r.moonPct} %{r.moonUp === null ? '' : r.moonUp ? ', up' : ', down'}</td>
									<td>{r.s.filter ?? 'none'}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				{/if}
				<p class="small muted">
					Medians of each session's accepted frames: the green pixels calibrated against the Gaia BP magnitudes of the field's stars. Higher is darker; the moon at the session's middle. Through a filter the numbers are the sky in its passbands, not an unfiltered (SQM-like) reading: a nebula filter blocks most airglow and artificial light, so the sky reads darker, and its zero point is lower (less starlight gets through). Compare sessions through the same filter.{#if Number.isFinite(bestZp)}
						{' '}A zero point well below the best {currentFilter ? `with the ${currentFilter}` : 'without a filter'} ({bestZp.toFixed(2)}) means dimmed stars (dew, haze, thin cloud) and a sky that reads brighter than it was.{/if}
				</p>
			</Card>

			<Card title="Targets">
				<table>
					<thead><tr><th>Target</th><th>Integration</th><th>Nights</th><th>Frames</th><th>Accepted</th><th>Last</th></tr></thead>
					<tbody>
						{#each targets as t (t.key)}
							{@const frames = t.sessions.reduce((n, s) => n + s.accepted + s.rejected, 0)}
							{@const accepted = t.sessions.reduce((n, s) => n + s.accepted, 0)}
							{@const last = t.sessions[t.sessions.length - 1]}
							<tr>
								<td><a href="/goals">{t.key}</a>{#if t.dso?.names[0]}<span class="muted name">{t.dso.names[0]}</span>{/if}</td>
								<td class="num">{formatDuration(t.integrationS)}</td>
								<td class="num">{t.nights.length}</td>
								<td class="num">{frames}</td>
								<td class="num">{share(accepted, frames)}</td>
								<td>{#if last}<a href="/sessions/{last.id}">{nightLabel(last.night, false)}</a>{/if}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</Card>
		</div>
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
	.grid {
		display: grid;
		gap: var(--gap);
		grid-template-columns: minmax(0, 1fr);
	}
	@media (min-width: 1000px) {
		.grid {
			grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
		}
	}
	.facts {
		margin: 0;
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
		gap: 10px 16px;
	}
	dt {
		font-size: 12px;
		color: var(--muted);
	}
	dd {
		margin: 2px 0 0;
		font-size: 18px;
		font-weight: 600;
	}
	table {
		width: 100%;
		border-collapse: collapse;
		font-size: 13px;
	}
	th {
		text-align: left;
		font-weight: 500;
		font-size: 12px;
		color: var(--muted);
		padding: 0 8px 6px 0;
	}
	td {
		padding: 4px 8px 4px 0;
		border-top: 1px solid var(--border);
	}
	td.num,
	th:not(:first-child) {
		text-align: right;
	}
	td:last-child,
	th:last-child {
		padding-right: 0;
	}
	.bars {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 6px;
		font-size: 13px;
	}
	.bars li {
		display: grid;
		grid-template-columns: minmax(0, 13em) minmax(0, 1fr) 6.5em;
		gap: 10px;
		align-items: center;
	}
	.bars .num {
		text-align: right;
	}
	.bar {
		height: 8px;
		border-radius: 4px;
		background: var(--surface-strong);
		overflow: hidden;
	}
	.bar i {
		display: block;
		height: 100%;
		background: var(--line4);
	}
	.name {
		margin-left: 0.4em;
	}
</style>
