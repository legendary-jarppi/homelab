<script lang="ts">
	import { untrack } from 'svelte';
	import { page } from '$app/state';
	import Card from '$lib/components/Card.svelte';
	import Framing from '$lib/components/Framing.svelte';
	import TimeChart, { type ChartMark } from '$lib/components/TimeChart.svelte';
	import { appeal, CATALOG_SOURCES, catalog, FIELD_ARCMIN, findDso, formatSize, framing, GROUP_LABELS, searchCatalog, typeLabel, type Dso, type DsoGroup } from '$lib/catalog';
	import { clock, formatDuration, nightLabel } from '$lib/format';
	import { integrationById } from '$lib/goals';
	import { altitudeCurve, DEFAULT_MIN_ALTITUDE, nightDate, placement, planNight, planTarget, type TargetPlan } from '$lib/planner';
	import { nightNoon } from '$lib/sky';
	import { TargetStore } from '$lib/targets.svelte';

	/**
	 * C1: which catalog objects are well placed on a night at the site: hours above the minimum altitude in
	 * darkness, transit, moon distance and illumination, size against the camera's field; best first, with
	 * filters, a wishlist, and each object's altitude curve.
	 */
	let { data } = $props();

	const store = new TargetStore(
		untrack(() => data.targets),
		untrack(() => data.targetsError)
	);
	const tonight = nightDate(nightNoon(Date.now()));
	let date = $state(tonight);
	let minAltitude = $state(DEFAULT_MIN_ALTITUDE);
	let query = $state(untrack(() => page.url.searchParams.get('q') ?? ''));
	let group = $state<DsoGroup | 'all'>('all');
	let minSize = $state(0);
	let maxMag = $state<number | null>(null);
	let wishlistOnly = $state(false);
	let visibleOnly = $state(true);
	type SortKey = 'best' | 'hours' | 'altitude' | 'transit' | 'size' | 'mag';
	let sort = $state<SortKey>('best');
	let limit = $state(40);
	/** The expanded object: the one asked for with ?q=, if it names one. */
	let open = $state<string | null>(untrack(() => findDso(page.url.searchParams.get('q') ?? '')?.id ?? null));

	const SORTS: [SortKey, string][] = [
		['best', 'Best'],
		['hours', 'Hours'],
		['altitude', 'Altitude'],
		['transit', 'Transit'],
		['size', 'Size'],
		['mag', 'Brightness']
	];
	const GROUPS: (DsoGroup | 'all')[] = ['all', 'nebula', 'galaxy', 'cluster', 'globular', 'planetary'];
	const SIZES = [0, 5, 15, 30, 60];
	const MAGS = [null, 8, 10, 12];

	const site = $derived(data.site);
	const night = $derived(site && /^\d{4}-\d{2}-\d{2}$/.test(date) ? planNight(site, nightNoon(date)) : null);
	/** Every object's plan for the night and limit (about 1500 × 70 altitudes: a few ms). */
	const plans = $derived.by(() => {
		const out = new Map<string, TargetPlan>();
		if (night) for (const o of catalog) out.set(o.id, planTarget(o, night, minAltitude));
		return out;
	});
	const integration = $derived(integrationById(data.sessions));
	const wished = (o: Dso) => store.targets[o.id]?.wishlist ?? false;
	const matches = $derived(query.trim() ? searchCatalog(query) : catalog);
	const rows = $derived.by(() => {
		const searching = query.trim() !== '';
		const out = matches.filter((o) => {
			const p = plans.get(o.id);
			if (group !== 'all' && o.group !== group && !(group === 'nebula' && o.group === 'dark')) return false;
			if (minSize && (o.maj ?? 0) < minSize) return false;
			if (maxMag !== null && (o.mag === null || o.mag > maxMag)) return false;
			if (wishlistOnly && !wished(o)) return false;
			if (visibleOnly && !searching && p && p.hours <= 0) return false;
			return true;
		});
		if (searching && sort === 'best') return out;
		const key: Record<SortKey, (o: Dso) => number> = {
			best: (o) => -(plans.get(o.id)?.score ?? 0) * appeal(o),
			hours: (o) => -(plans.get(o.id)?.hours ?? 0),
			altitude: (o) => -(plans.get(o.id)?.maxAltitude ?? -90),
			transit: (o) => plans.get(o.id)?.transit ?? 0,
			size: (o) => -(o.maj ?? 0),
			mag: (o) => o.mag ?? 99
		};
		const k = key[sort];
		return out.sort((a, b) => k(a) - k(b));
	});
	const shown = $derived(rows.slice(0, limit));
	const wishlistCount = $derived(Object.values(store.targets).filter((t) => t.wishlist).length);

	const darkness = $derived(night?.window ? `${night.darkness === 'astronomical' ? 'Astronomical' : 'Nautical'} dark ${clock(night.window.start)}–${clock(night.window.end)}` : 'No nautical darkness');
	const moonText = $derived.by(() => {
		if (!night) return '';
		const m = night.sky.moon;
		const events = m.events.map((e) => `${e.kind === 'rise' ? 'rises' : 'sets'} ${clock(e.at)}`).join(', ');
		return `Moon ${Math.round(m.illumination * 100)} %${events ? `, ${events}` : m.upAtDark ? ', up all night' : ', down all night'}`;
	});

	function chart(o: Dso) {
		if (!night) return null;
		const p = plans.get(o.id)!;
		const bands: { from: number; to: number; fill: string }[] = [];
		if (night.sky.nautical) bands.push({ from: night.sky.nautical.start / 1000, to: night.sky.nautical.end / 1000, fill: 'var(--dark)' });
		if (night.sky.astronomical) bands.push({ from: night.sky.astronomical.start / 1000, to: night.sky.astronomical.end / 1000, fill: 'var(--dark)' });
		if (p.best) bands.push({ from: p.best.start / 1000, to: p.best.end / 1000, fill: 'color-mix(in srgb, var(--ok) 14%, transparent)' });
		const marks: ChartMark[] = [];
		if (p.transit >= night.from && p.transit <= night.to) marks.push({ at: p.transit / 1000, label: 'Transit', dash: true, color: 'var(--muted)' });
		return {
			from: night.from / 1000,
			to: night.to / 1000,
			series: [
				{ points: night.times.map((t, i): [number, number] => [t / 1000, night.moon[i].altitude]), color: 'var(--muted)', dash: '2 3', width: 1 },
				{ points: altitudeCurve(o, night), color: 'var(--line1)', width: 2 }
			],
			bands,
			marks
		};
	}
</script>

{#snippet star(filled: boolean)}
	<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.2l2.7 5.6 6.1.8-4.5 4.2 1.1 6.1L12 17l-5.4 2.9 1.1-6.1-4.5-4.2 6.1-.8z" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" /></svg>
{/snippet}

<svelte:head><title>Planner · Telescope</title></svelte:head>

{#if !site || !night}
	<Card title="Planner"><p class="muted">{site ? 'Choose a date.' : 'Site not set up (TELESCOPE_SITE).'}</p></Card>
{:else}
	<main>
		<Card title="Night at {site.name}">
			{#snippet accessory()}
				<span class="num">{rows.length} {rows.length === 1 ? 'target' : 'targets'}</span>
			{/snippet}
			<div class="controls">
				<label>Night of <input class="field" type="date" bind:value={date} /></label>
				{#if date !== tonight}<button class="btn" onclick={() => (date = tonight)}>Tonight</button>{/if}
				<label>Above <input class="field narrow" type="number" min="0" max="80" step="5" bind:value={minAltitude} />°</label>
			</div>
			<p class="summary">{nightLabel(date)} · {darkness} · {moonText}</p>
			<p class="muted small">Hours above {minAltitude}° in {night.darkness === 'nautical' ? 'nautical (no astronomical) darkness' : 'astronomical darkness'}. Field {(FIELD_ARCMIN / 60).toFixed(2)}° × {(FIELD_ARCMIN / 60).toFixed(2)}° (670 mm, ASI533).</p>
		</Card>

		<section class="filters" aria-label="Filters">
			<input class="field search" type="search" placeholder="Search: M 31, NGC 7000, Sh2-155, Pleiades, Cyg…" bind:value={query} oninput={() => (limit = 40)} />
			<div class="chips">
				{#each GROUPS as g (g)}
					<button class="btn" class:on={group === g} onclick={() => (group = g)}>{g === 'all' ? 'All' : GROUP_LABELS[g]}</button>
				{/each}
			</div>
			<div class="chips">
				<label class="select">Size <select class="field" bind:value={minSize}>{#each SIZES as s (s)}<option value={s}>{s ? `≥ ${s}′` : 'any'}</option>{/each}</select></label>
				<label class="select">Mag <select class="field" bind:value={maxMag}>{#each MAGS as m (m)}<option value={m}>{m === null ? 'any' : `≤ ${m}`}</option>{/each}</select></label>
				<label class="select">Sort <select class="field" bind:value={sort}>{#each SORTS as [k, label] (k)}<option value={k}>{label}</option>{/each}</select></label>
				<button class="btn" class:on={wishlistOnly} onclick={() => (wishlistOnly = !wishlistOnly)}>{@render star(wishlistOnly)} Wishlist{wishlistCount ? ` ${wishlistCount}` : ''}</button>
				<button class="btn" class:on={!visibleOnly} onclick={() => (visibleOnly = !visibleOnly)} title="Also objects that are not above the limit in darkness">Not visible too</button>
			</div>
			{#if store.error}<p class="small warn">{store.error}</p>{/if}
		</section>

		{#if rows.length === 0}
			<Card><p class="muted">Nothing matches{visibleOnly ? ` above ${minAltitude}° in darkness` : ''}.</p></Card>
		{:else}
			<ul class="list">
				{#each shown as o (o.id)}
					{@const p = plans.get(o.id)!}
					{@const place = placement(p, night.sky.moon.illumination)}
					{@const sofar = integration.get(o.id)}
					{@const goal = store.targets[o.id]?.goalHours ?? null}
					<li class:open={open === o.id}>
						<div class="row">
							<button class="main" onclick={() => (open = open === o.id ? null : o.id)} aria-expanded={open === o.id}>
								<Framing maj={o.maj} min={o.min} size={44} />
								<span class="name">
									<strong>{o.id}</strong>{#if o.names[0]}<span class="common"> {o.names[0]}</span>{/if}
									<span class="muted small">{typeLabel(o.type)}{o.con ? ` · ${o.con}` : ''} · {o.maj !== null ? `${formatSize(o.maj)}${o.min !== null && o.min !== o.maj ? ` × ${formatSize(o.min)}` : ''} · ` : ''}{framing(o).label}{o.mag !== null ? ` · mag ${o.mag.toFixed(1)}` : ''}</span>
									{#if sofar || goal}<span class="small"><span class="tag accent">{sofar ? `${formatDuration(sofar)}${goal ? ` of ${goal} h` : ''}` : `goal ${goal} h`}</span></span>{/if}
								</span>
								<span class="nums num">
									<span class="hours" class:good={place.good}>{p.hours <= 0 ? '–' : `${p.hours.toFixed(1)} h`}</span>
									<span class="muted small">max {Math.max(0, p.maxAltitude).toFixed(0)}° · transit {clock(p.transit)}</span>
									<span class="muted small" class:warn={p.moonUp && night.sky.moon.illumination > 0.3 && p.moonDistance < 40}>moon {p.moonUp ? `${p.moonDistance.toFixed(0)}°` : 'down'}</span>
								</span>
							</button>
							<button class="star" class:on={wished(o)} disabled={store.busy === o.id} onclick={() => store.save(o.id, { wishlist: !wished(o) })} aria-pressed={wished(o)} aria-label="{wished(o) ? 'Remove from' : 'Add to'} wishlist">{@render star(wished(o))}</button>
						</div>
						{#if open === o.id}
							{@const c = chart(o)}
							<div class="detail">
								{#if c}
									<TimeChart from={c.from} to={c.to} height={130} yMin={0} yMax={90} yFormat={(v) => `${Math.round(v)}°`} series={c.series} bands={c.bands} marks={c.marks} hlines={[{ y: minAltitude, color: 'var(--warn)', dash: true }]} label="Altitude of {o.id}" />
								{/if}
								<div class="facts">
									<Framing maj={o.maj} min={o.min} pa={null} size={120} panels />
									<dl>
										<div><dt>Best window</dt><dd class="num">{p.best ? `${clock(p.best.start)}–${clock(p.best.end)}` : `not above ${minAltitude}°`}</dd></div>
										<div><dt>Transit</dt><dd class="num">{clock(p.transit)} at {p.transitAltitude.toFixed(0)}°</dd></div>
										<div><dt>Moon</dt><dd class="num">{Math.round(night.sky.moon.illumination * 100)} %, {p.moonUp ? `${p.moonDistance.toFixed(0)}° away` : 'down'}</dd></div>
										<div><dt>Framing</dt><dd>{framing(o).label}</dd></div>
										{#if o.aliases.length}<div class="wide"><dt>Also</dt><dd>{o.aliases.join(', ')}{o.names.length > 1 ? `; ${o.names.slice(1).join(', ')}` : ''}</dd></div>{/if}
										<div class="wide"><dt>Imaged</dt><dd>{sofar ? formatDuration(sofar) : 'not yet'}{goal ? ` of ${goal} h goal` : ''} · <a href="/goals#target-{encodeURIComponent(o.id)}">Goals</a></dd></div>
									</dl>
								</div>
							</div>
						{/if}
					</li>
				{/each}
			</ul>
			{#if rows.length > limit}<button class="btn more" onclick={() => (limit += 60)}>Show more ({rows.length - limit} left)</button>{/if}
		{/if}
		<p class="credit faint small">
			Catalog:
			{#each CATALOG_SOURCES as source, i (source.url)}{i ? '; ' : ''}<a href={source.url}>{source.name}</a> ({source.attribution}), <a href={source.licenseUrl}>{source.license}</a>{/each}.
		</p>
	</main>
{/if}

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
		font-size: 13px;
	}
	.controls {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px 14px;
		font-size: 14px;
	}
	.controls label {
		display: inline-flex;
		align-items: center;
		gap: 6px;
	}
	.narrow {
		width: 64px;
	}
	.summary {
		font-size: 15px;
	}
	.filters {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.search {
		width: 100%;
		font-size: 16px;
		padding: 9px 14px;
		border-radius: 14px;
	}
	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		align-items: center;
	}
	.select {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		font-size: 13px;
		color: var(--muted);
	}
	.select .field {
		padding: 4px 6px;
		font-size: 13px;
	}
	.list {
		margin: 0;
		padding: 0;
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.list li {
		border-radius: 16px;
		background: var(--surface);
		border: 1px solid var(--border);
	}
	.row {
		display: flex;
		align-items: center;
	}
	.main {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 8px 4px 8px 10px;
		border: 0;
		background: none;
		text-align: left;
		cursor: pointer;
	}
	.name {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
		font-size: 16px;
	}
	.common {
		color: var(--muted);
		font-size: 14px;
	}
	.nums {
		flex: none;
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 1px;
		text-align: right;
	}
	.hours {
		font-size: 18px;
		font-weight: 650;
		color: var(--muted);
	}
	.hours.good {
		color: var(--ok);
	}
	.star {
		flex: none;
		width: 44px;
		height: 44px;
		margin-right: 4px;
		border: 0;
		background: none;
		display: grid;
		place-items: center;
		color: var(--muted);
		cursor: pointer;
	}
	.star.on {
		color: var(--warn);
	}
	.star .icon {
		width: 24px;
		height: 24px;
	}
	.icon {
		width: 15px;
		height: 15px;
		display: block;
	}
	.detail {
		display: flex;
		flex-direction: column;
		gap: 10px;
		padding: 0 12px 12px;
	}
	.facts {
		display: flex;
		gap: 14px;
		align-items: flex-start;
	}
	dl {
		flex: 1;
		margin: 0;
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
		gap: 8px 14px;
		font-size: 14px;
	}
	dl .wide {
		grid-column: 1 / -1;
	}
	dt {
		font-size: 12px;
		color: var(--muted);
	}
	dd {
		margin: 0;
	}
	.more {
		align-self: center;
	}
	.credit {
		margin-top: 6px;
	}
	@media (max-width: 640px) {
		.main {
			gap: 10px;
		}
		.facts {
			flex-direction: column;
		}
		.facts dl {
			width: 100%;
		}
	}
</style>
