<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import Card from '$lib/components/Card.svelte';
	import TimeChart from '$lib/components/TimeChart.svelte';
	import { clock, fixed } from '$lib/format';
	import type { KpPoint, SeeingPoint } from '$lib/types';

	/**
	 * C2 and C3: tonight at the site. Darkness and moon (computed), a verdict line, cloud by height from several
	 * models side by side, 7Timer seeing and transparency, wind, temperature against dew point; aurora: Kp
	 * (observed and forecast) and the OVATION probability. Each source shows "unavailable" on its own.
	 */
	let { data } = $props();
	const c = $derived(data.conditions);

	$effect(() => {
		const timer = setInterval(() => invalidateAll(), 10 * 60_000);
		return () => clearInterval(timer);
	});

	const HOUR = 3_600_000;
	const LAYERS = [
		['high', 'High'],
		['mid', 'Mid'],
		['low', 'Low']
	] as const;
	const SEEING = ['', '< 0.5', '0.5–0.75', '0.75–1', '1–1.25', '1.25–1.5', '1.5–2', '2–2.5', '> 2.5'];
	const TRANSPARENCY = ['', '< 0.3', '0.3–0.4', '0.4–0.5', '0.5–0.6', '0.6–0.7', '0.7–0.85', '0.85–1', '> 1'];
	/** 7Timer classes 1 (best) … 8 as a 0…1 badness. */
	const badness = (v: number | null) => (v === null ? null : (v - 1) / 7);

	const dark = $derived.by(() => {
		if (!c) return [];
		const a = c.sky.astronomical;
		const n = c.sky.nautical;
		return c.times.map((t) => {
			const mid = t + HOUR / 2;
			return a && mid >= a.start && mid < a.end ? 'astro' : n && mid >= n.start && mid < n.end ? 'nautical' : '';
		});
	});
	const seeingCells = $derived.by(() => {
		if (!c?.seeing.data || !c.times.length) return [];
		const from = c.times[0];
		const to = c.times.at(-1)! + HOUR;
		return c.seeing.data.filter((p: SeeingPoint) => p.time + 1.5 * HOUR > from && p.time - 1.5 * HOUR < to);
	});
	const weatherSeries = $derived(c?.weather.data ?? []);
	const span = $derived(c && c.times.length ? { from: c.times[0] / 1000, to: (c.times.at(-1)! + HOUR) / 1000 } : null);
	const darkBands = $derived(
		c ? [c.sky.nautical, c.sky.astronomical].filter((w) => w !== null).map((w) => ({ from: w!.start / 1000, to: w!.end / 1000, fill: 'var(--dark)' })) : []
	);

	const kpPoints = $derived.by(() => {
		const pts = c?.kp.data?.points ?? [];
		const nowMs = c?.updatedAt ?? 0;
		return pts.filter((p: KpPoint) => p.time > nowMs - 2 * 86_400_000);
	});
	let kpWidth = $state(0);
	const KP_H = 110;
	const kpClass = (kp: number) => (kp >= 5 ? 'storm' : kp >= 4 ? 'active' : kp >= 3 ? 'unsettled' : '');
	const moonPct = $derived(c ? Math.round(c.sky.moon.illumination * 100) : 0);
	const phaseName = (p: number) =>
		p < 0.03 || p > 0.97 ? 'New moon' : p < 0.22 ? 'Waxing crescent' : p < 0.28 ? 'First quarter' : p < 0.47 ? 'Waxing gibbous' : p < 0.53 ? 'Full moon' : p < 0.72 ? 'Waning gibbous' : p < 0.78 ? 'Last quarter' : 'Waning crescent';
</script>

<svelte:head><title>Conditions · Telescope</title></svelte:head>

{#if !c}
	<Card title="Conditions"><p class="muted">Site not set up (TELESCOPE_SITE).</p></Card>
{:else}
	<main class="grid">
		<div class="verdict">
			<Card title="Tonight at {c.site.name}">
				{#snippet accessory()}<span class="num">updated {clock(c.updatedAt)}</span>{/snippet}
				<p class="line">{c.verdict}</p>
				<dl class="facts">
					<div>
						<dt>Astronomical dark</dt>
						<dd class="num">{c.sky.astronomical ? `${clock(c.sky.astronomical.start)}–${clock(c.sky.astronomical.end)}` : 'None tonight'}</dd>
					</div>
					<div>
						<dt>Nautical dark</dt>
						<dd class="num">{c.sky.nautical ? `${clock(c.sky.nautical.start)}–${clock(c.sky.nautical.end)}` : `None (sun ≥ ${c.sky.sunLowest.toFixed(0)}°)`}</dd>
					</div>
					<div><dt>Sunset · sunrise</dt><dd class="num">{c.sky.sunset ? clock(c.sky.sunset) : '–'} · {c.sky.sunrise ? clock(c.sky.sunrise) : '–'}</dd></div>
					<div><dt>Moon</dt><dd>{phaseName(c.sky.moon.phase)}, <span class="num">{moonPct} %</span></dd></div>
					<div>
						<dt>Moon rise · set</dt>
						<dd class="num">
							{#each c.sky.moon.events as e, i (i)}{i ? ' · ' : ''}{e.kind === 'rise' ? '↑' : '↓'} {clock(e.at)}{:else}–{/each}
						</dd>
					</div>
				</dl>
			</Card>
		</div>

		<div class="clouds">
			<Card title="Cloud by height">
				{#snippet accessory()}<span>Open-Meteo models</span>{/snippet}
				{#if c.models.error}
					<p class="muted">Cloud models unavailable: {c.models.error}</p>
				{:else if c.models.data}
					<div class="heat" style:--cols={c.times.length}>
						<span class="rowlabel"></span>
						{#each c.times as t, i (t)}<span class="hour num">{i % 2 === 0 ? new Date(t).getHours() : ''}</span>{/each}
						<span class="rowlabel faint">dark</span>
						{#each dark as d, i (i)}<span class="darkcell {d}"></span>{/each}
						<span class="rowlabel faint">moon</span>
						{#each c.moonAltitude as a, i (i)}<span class="mooncell" style:opacity={a > 0 ? Math.min(1, 0.25 + a / 40) * c.sky.moon.illumination + 0.08 : 0}></span>{/each}
						{#each c.models.data as m (m.id)}
							<span class="model">{m.label}</span>
							{#each LAYERS as [key, label] (key)}
								<span class="rowlabel faint">{label}</span>
								{#each m[key] as v, i (i)}
									<span class="cell" class:none={v === null} style:--a={v === null ? 0 : v / 100} title="{m.label} {label.toLowerCase()} {clock(c.times[i])}: {v ?? '–'} %"></span>
								{/each}
							{/each}
						{/each}
					</div>
					<p class="faint small">Brighter = more cloud. Hours from sunset to sunrise; empty where a model does not reach (MET Nordic ~2.5 days).</p>
				{/if}
			</Card>
		</div>

		<div class="seeing">
			<Card title="Seeing and transparency">
				{#snippet accessory()}<span>7Timer ASTRO</span>{/snippet}
				{#if c.seeing.error}
					<p class="muted">7Timer unavailable: {c.seeing.error}</p>
				{:else if seeingCells.length}
					<div class="seeing-grid" style:--cols={seeingCells.length}>
						<span class="rowlabel"></span>
						{#each seeingCells as p (p.time)}<span class="hour num">{clock(p.time)}</span>{/each}
						<span class="rowlabel faint">seeing ″</span>
						{#each seeingCells as p (p.time)}<span class="sv" style:--b={badness(p.seeing)}>{p.seeing ? SEEING[p.seeing] : '–'}</span>{/each}
						<span class="rowlabel faint">transp.</span>
						{#each seeingCells as p (p.time)}<span class="sv" style:--b={badness(p.transparency)}>{p.transparency ? TRANSPARENCY[p.transparency] : '–'}</span>{/each}
					</div>
					<p class="faint small">Seeing: star size from turbulence. Transparency: extinction, mag per airmass. Three-hour steps, lower is better.</p>
				{:else}
					<p class="muted">No 7Timer data for tonight.</p>
				{/if}
			</Card>
		</div>

		<div class="weather">
			<Card title="Wind and dew">
				{#if c.weather.error}
					<p class="muted">Open-Meteo unavailable: {c.weather.error}</p>
				{:else if span && weatherSeries.length}
					<span class="plabel"><i style:background="var(--line1)"></i>Temperature <i style:background="var(--line2)"></i>dew point °C</span>
					<TimeChart
						from={span.from}
						to={span.to}
						height={90}
						axis={false}
						yFormat={(v) => v.toFixed(0)}
						bands={darkBands}
						series={[
							{ points: weatherSeries.map((h) => [h.time / 1000 + 1800, h.temperature]), color: 'var(--line1)' },
							{ points: weatherSeries.map((h) => [h.time / 1000 + 1800, h.dewPoint]), color: 'var(--line2)', dash: '4 3' }
						]}
						label="Temperature and dew point"
					/>
					<span class="plabel"><i style:background="var(--line3)"></i>Wind (solid), gusts (dashed) m/s</span>
					<TimeChart
						from={span.from}
						to={span.to}
						height={90}
						yMin={0}
						yFormat={(v) => v.toFixed(0)}
						bands={darkBands}
						series={[
							{ points: weatherSeries.map((h) => [h.time / 1000, h.wind]), color: 'var(--line3)', kind: 'step' },
							{ points: weatherSeries.map((h) => [h.time / 1000, h.gusts]), color: 'var(--line3)', kind: 'step', dash: '4 3', width: 1 }
						]}
						label="Wind"
					/>
					{@const humid = weatherSeries.filter((h) => h.temperature !== null && h.dewPoint !== null && h.temperature - h.dewPoint <= 2)}
					<p class="small {humid.length ? 'warn' : 'faint'}">
						{humid.length ? `Within 2° of the dew point from ${clock(humid[0].time)} (${humid.length} h): dew heater on.` : 'Air stays more than 2° above the dew point.'}
						Humidity {fixed(Math.min(...weatherSeries.map((h) => h.humidity ?? 100)))}–{fixed(Math.max(...weatherSeries.map((h) => h.humidity ?? 0)))} %.
					</p>
				{/if}
			</Card>
		</div>

		<div class="aurora">
			<Card title="Aurora">
				{#snippet accessory()}<span>NOAA SWPC</span>{/snippet}
				<p class="line">{c.auroraLine}</p>
				{#if c.aurora.data}
					<dl class="facts">
						<div><dt>Probability here</dt><dd class="num">{c.aurora.data.probability} %</dd></div>
						<div><dt>To the north (≤ 1000 km)</dt><dd class="num">{c.aurora.data.northProbability} %</dd></div>
						{#if c.kp.data?.now !== null && c.kp.data?.now !== undefined}<div><dt>Kp, latest 3 h</dt><dd class="num">{c.kp.data.now.toFixed(2)}</dd></div>{/if}
						{#if c.aurora.data.forecastAt}<div><dt>OVATION for</dt><dd class="num">{clock(c.aurora.data.forecastAt)}</dd></div>{/if}
					</dl>
				{:else}
					<p class="muted small">OVATION unavailable: {c.aurora.error}</p>
				{/if}
				{#if c.kp.error}
					<p class="muted small">Kp unavailable: {c.kp.error}</p>
				{:else if kpPoints.length}
					<div class="kp" bind:clientWidth={kpWidth}>
						{#if kpWidth > 0}
							{@const bw = (kpWidth - 24) / kpPoints.length}
							{@const nowIdx = kpPoints.findIndex((p) => p.time > c.updatedAt) }
							<svg width={kpWidth} height={KP_H + 16} role="img" aria-label="Planetary Kp, observed and forecast">
								{#each [3, 5, 7] as level (level)}
									<line x1="24" x2={kpWidth} y1={KP_H - (level / 9) * KP_H} y2={KP_H - (level / 9) * KP_H} class="kpgrid" />
									<text x="18" y={KP_H - (level / 9) * KP_H} dy="0.35em" text-anchor="end" class="lab">{level}</text>
								{/each}
								{#each kpPoints as p, i (p.time)}
									<rect x={24 + i * bw + 0.5} y={KP_H - (p.kp / 9) * KP_H} width={Math.max(1, bw - 1)} height={(p.kp / 9) * KP_H} class="bar {kpClass(p.kp)}" class:predicted={p.kind === 'predicted'}><title>{new Date(p.time).toLocaleString('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit' })} Kp {p.kp.toFixed(2)} ({p.kind})</title></rect>
									{#if new Date(p.time).getHours() < 3}<text x={24 + i * bw} y={KP_H + 12} class="lab">{new Date(p.time).toLocaleDateString('en-GB', { weekday: 'short' })}</text>{/if}
								{/each}
								{#if nowIdx > 0}<line x1={24 + nowIdx * bw} x2={24 + nowIdx * bw} y1="0" y2={KP_H} class="now" />{/if}
							</svg>
						{/if}
					</div>
					<p class="faint small">Planetary Kp per 3 h, the past two days and the forecast (hollow). At about 61° N aurora shows low in the north from Kp 3 and overhead from Kp 5.</p>
				{/if}
			</Card>
		</div>
	</main>
{/if}

<style>
	p {
		margin: 0;
	}
	.small {
		font-size: 12px;
	}
	.line {
		font-size: 16px;
		font-weight: 550;
		line-height: 1.4;
	}
	.grid {
		display: grid;
		gap: var(--gap);
		grid-template-columns: minmax(0, 1fr);
	}
	@media (min-width: 1000px) {
		.grid {
			grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
			grid-template-areas: 'verdict aurora' 'clouds weather' 'clouds seeing';
			align-items: stretch;
		}
		.verdict {
			grid-area: verdict;
		}
		.clouds {
			grid-area: clouds;
		}
		.seeing {
			grid-area: seeing;
		}
		.weather {
			grid-area: weather;
		}
		.aurora {
			grid-area: aurora;
		}
	}
	.grid > div {
		min-width: 0;
	}
	.facts {
		margin: 0;
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
		gap: 10px 16px;
	}
	dt {
		font-size: 12px;
		color: var(--muted);
	}
	dd {
		margin: 2px 0 0;
		font-size: 15px;
		font-weight: 600;
	}
	.heat,
	.seeing-grid {
		display: grid;
		grid-template-columns: 44px repeat(var(--cols), minmax(0, 1fr));
		gap: 2px;
		align-items: center;
	}
	.seeing-grid {
		grid-template-columns: 52px repeat(var(--cols), minmax(0, 1fr));
		gap: 3px;
	}
	.hour {
		font-size: 10px;
		color: var(--faint);
		text-align: left;
		white-space: nowrap;
	}
	.rowlabel {
		font-size: 10px;
		text-align: right;
		padding-right: 4px;
	}
	.model {
		grid-column: 1 / -1;
		margin-top: 6px;
		font-size: 12px;
		font-weight: 600;
		color: var(--muted);
	}
	.cell {
		height: 12px;
		border-radius: 2px;
		background: rgba(var(--cloud), calc(0.06 + var(--a) * 0.84));
	}
	.cell.none {
		background: none;
		border: 1px dashed var(--border);
	}
	.darkcell {
		height: 6px;
		border-radius: 2px;
		background: var(--surface);
	}
	.darkcell.nautical {
		background: var(--surface-strong);
		opacity: 0.6;
	}
	.darkcell.astro {
		background: var(--accent);
		opacity: 0.45;
	}
	.mooncell {
		height: 6px;
		border-radius: 2px;
		background: var(--text);
	}
	.sv {
		font-size: 10px;
		letter-spacing: -0.03em;
		text-align: center;
		padding: 5px 0;
		border-radius: 6px;
		font-variant-numeric: tabular-nums;
		background: color-mix(in srgb, var(--ok) calc((1 - var(--b, 1)) * 45%), color-mix(in srgb, var(--warn) calc(var(--b, 1) * 40%), transparent));
		white-space: nowrap;
		overflow: hidden;
	}
	.plabel {
		display: flex;
		align-items: center;
		gap: 5px;
		font-size: 11px;
		color: var(--faint);
	}
	.plabel i {
		display: inline-block;
		width: 8px;
		height: 8px;
		border-radius: 50%;
	}
	.kp svg {
		display: block;
	}
	.kpgrid {
		stroke: var(--border);
		stroke-dasharray: 3 4;
	}
	.lab {
		font-size: 10px;
		fill: var(--faint);
	}
	.bar {
		fill: var(--ok);
	}
	.bar.unsettled {
		fill: var(--warn);
	}
	.bar.active,
	.bar.storm {
		fill: var(--bad);
	}
	.bar.predicted {
		fill-opacity: 0.25;
		stroke: currentColor;
		color: var(--muted);
	}
	.now {
		stroke: var(--accent);
	}
</style>
