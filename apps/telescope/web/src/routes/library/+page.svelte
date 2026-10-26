<script lang="ts">
	import Card from '$lib/components/Card.svelte';
	import { ANGLE_MATCH_DEG, BIAS_MAX_DAYS, DARK_MAX_DAYS, FLAT_MAX_DAYS, RECENT_DAYS, TEMP_MATCH_C } from '$lib/calibration';
	import { fixed, nightLabel } from '$lib/format';
	import type { AdviceReport, CalibrationChoice, CalibrationSet, CalibrationType, LibraryMatch, Master } from '$lib/types';

	/**
	 * D2: the calibration library: masters (with downloads) and the raw sets they were built from, by kind,
	 * exposure, gain, temperature and camera angle, with their ages; and per target which masters the
	 * processor would use and what does not quite fit.
	 */
	let { data } = $props();

	/** Ages past which the kind is worth renewing, days: the processor's own limits against the lights. */
	const STALE_DAYS: Record<CalibrationType, number> = { flat: FLAT_MAX_DAYS, dark: DARK_MAX_DAYS, bias: BIAS_MAX_DAYS };
	const TYPES: [CalibrationType, string][] = [
		['dark', 'Darks'],
		['flat', 'Flats'],
		['bias', 'Bias']
	];
	const DAY = 86_400_000;
	const today = Date.now();
	const age = (night: string) => Math.max(0, Math.floor((today - Date.parse(`${night}T12:00:00`)) / DAY));

	const targetNames = $derived([...new Set(data.sessions.map((s) => s.target))]);
	let target = $state('');
	$effect(() => {
		if (!target && targetNames.length) target = targetNames[0];
	});
	let match = $state.raw<LibraryMatch | null>(null);
	let matchError = $state<string | null>(null);
	$effect(() => {
		const name = target;
		if (!name || !data.library) return;
		const controller = new AbortController();
		fetch(`/api/library/match?target=${encodeURIComponent(name)}`, { signal: controller.signal })
			.then(async (r) => {
				if (!r.ok) throw new Error((await r.json().catch(() => null))?.message ?? `HTTP ${r.status}`);
				match = (await r.json()) as LibraryMatch;
				matchError = null;
			})
			.catch((e: Error) => {
				if (e.name !== 'AbortError') matchError = e.message;
			});
		return () => controller.abort();
	});

	// R6: what to take next (the server's calibration reminders, built at most every 10 min).
	let advice = $state.raw<AdviceReport | null>(null);
	let adviceError = $state<string | null>(null);
	$effect(() => {
		const controller = new AbortController();
		fetch('/api/advice', { signal: controller.signal })
			.then(async (r) => {
				if (!r.ok) throw new Error(`HTTP ${r.status}`);
				advice = (await r.json()) as AdviceReport;
			})
			.catch((e: Error) => {
				if (e.name !== 'AbortError') adviceError = e.message;
			});
		return () => controller.abort();
	});

	const masters = $derived(new Map((data.library?.masters ?? []).map((m) => [m.id, m])));
	const exposure = (s: number | null) => (s === null ? '–' : s < 1 ? `${+(s * 1000).toFixed(1)} ms` : `${+s.toFixed(1)} s`);
	const setting = (x: Pick<Master | CalibrationSet, 'exposureS' | 'gain' | 'offset' | 'rotatorDeg'>, temp: number | null) =>
		[exposure(x.exposureS), x.gain !== null ? `gain ${x.gain}` : null, x.offset !== null ? `offset ${x.offset}` : null, temp !== null ? `${fixed(temp, 0)} °C` : null, x.rotatorDeg !== null ? `angle ${fixed(x.rotatorDeg, 0)}°` : null].filter(Boolean).join(' · ');
	const CHOICE: [keyof Omit<CalibrationChoice, 'warnings'>, string][] = [
		['bias', 'Bias'],
		['dark', 'Dark'],
		['flat', 'Flat'],
		['darkFlat', 'Dark flat']
	];
</script>

<svelte:head><title>Library · Telescope</title></svelte:head>

{#snippet choice(c: CalibrationChoice)}
	<dl class="choice">
		{#each CHOICE as [key, label] (key)}
			{@const m = c[key] ? masters.get(c[key]!) : null}
			<div>
				<dt>{label}</dt>
				<dd>
					{#if c[key]}
						{#if m}<a href={m.fitsUrl} download>{m.id}</a><span class="meta muted small">{nightLabel(m.night)}, {age(m.night)} days old</span>{:else}{c[key]}{/if}
					{:else}<span class="muted">none</span>{/if}
				</dd>
			</div>
		{/each}
	</dl>
	{#if c.warnings.length}
		<ul class="warnings">{#each c.warnings as w (w)}<li class="warn">{w}</li>{/each}</ul>
	{:else}<p class="small ok">Everything matches.</p>{/if}
{/snippet}

<main>
	{#if !data.library}
		<Card title="Calibration library"><p class="muted">Unavailable: {data.libraryError}</p></Card>
	{:else}
		{@const lib = data.library}
		<Card title="To do">
			{#snippet accessory()}{#if advice?.calibration.length}<span class="num">{advice.calibration.length}</span>{/if}{/snippet}
			{#if adviceError}<p class="warn">Reminders unavailable: {adviceError}</p>
			{:else if !advice}<p class="muted">Loading…</p>
			{:else if !advice.calibration.length}<p class="small ok">Nothing to take: the lights of the last {RECENT_DAYS} days (and of targets with a goal) have matching calibration.</p>
			{:else}
				<ul class="list">
					{#each advice.calibration as item (item.text)}
						<li>
							<span class="tag" class:accent={item.kind === 'flat'}>{item.kind}</span>
							<span class="body" class:warn={item.level === 'warn'}>{item.text}</span>
						</li>
					{/each}
				</ul>
			{/if}
			<p class="faint small">For the targets imaged in the last {RECENT_DAYS} days or with a goal, from the processor's match below and its limits: flats at the lights' camera angle (±{ANGLE_MATCH_DEG}°, modulo 180°) within {FLAT_MAX_DAYS} days, darks of the lights' exposure, gain and temperature (±{TEMP_MATCH_C} °C) up to {DARK_MAX_DAYS} days older, a bias up to {BIAS_MAX_DAYS} days old.</p>
		</Card>
		<div class="match">
			<Card title="Calibration for a target">
				{#snippet accessory()}
					{#if targetNames.length}
						<select class="field" bind:value={target} aria-label="Target">{#each targetNames as n (n)}<option value={n}>{n}</option>{/each}</select>
					{/if}
				{/snippet}
				{#if !targetNames.length}<p class="muted">No sessions yet.</p>
				{:else if matchError}<p class="warn">Match unavailable: {matchError}</p>
				{:else if match}
					{@render choice(match)}
					{#if match.nights && match.nights.length > 1}
						<details>
							<summary class="btn">Per night ({match.nights.length})</summary>
							{#each match.nights as n (n.night)}
								<div class="night">
									<strong class="small">{nightLabel(n.night)}</strong>
									{@render choice(n)}
								</div>
							{/each}
						</details>
					{/if}
				{:else}<p class="muted">Loading…</p>{/if}
			</Card>
		</div>

		<Card title="Masters">
			{#snippet accessory()}<span class="num">{lib.masters.length}</span>{/snippet}
			{#if !lib.masters.length}<p class="muted">No masters yet: the processor builds them from the sets below.</p>{/if}
			<ul class="list">
				{#each lib.masters as m (m.id)}
					{@const days = age(m.night)}
					<li>
						<span class="tag" class:accent={m.type === 'flat'}>{m.type}</span>
						<span class="body">
							<span class="num">{setting(m, m.tempC)}</span>
							<span class="small muted num">{nightLabel(m.night)} · <span class:warn={days > STALE_DAYS[m.type]}>{days} days old</span> · {m.frames} frames{m.median !== null ? ` · median ${fixed(m.median, 0)}` : ''}{m.noise !== null ? `, noise ${fixed(m.noise, 1)}` : ''}</span>
						</span>
						<a class="btn" href={m.fitsUrl} download>FITS</a>
					</li>
				{/each}
			</ul>
		</Card>

		<div class="sets">
			{#each TYPES as [type, label] (type)}
				{@const sets = lib.sets.filter((s) => s.type === type)}
				<Card title={label}>
					{#snippet accessory()}<span class="num">{sets.length} sets</span>{/snippet}
					{#if !sets.length}<p class="muted small">None archived.</p>{/if}
					<ul class="list">
						{#each sets as s (s.id)}
							{@const days = age(s.night)}
							<li>
								<span class="body">
									<span class="num">{setting(s, s.sensorTempC)}</span>
									<span class="small muted num">{nightLabel(s.night)} · <span class:warn={days > STALE_DAYS[type]}>{days} d</span> · {s.count} frames{s.setTempC !== null ? ` · set ${s.setTempC} °C` : ''}{s.binning && s.binning > 1 ? ` · bin ${s.binning}` : ''}{s.camera ? ` · ${s.camera}` : ''}{type === 'flat' ? ` · ${s.filter ?? 'no filter'}` : ''}</span>
								</span>
							</li>
						{/each}
					</ul>
				</Card>
			{/each}
		</div>
		<p class="faint small">Ages past {STALE_DAYS.flat} days (flats), {STALE_DAYS.dark} (darks) and {STALE_DAYS.bias} (bias) are marked. Raw sets come with the download on the Finals page; masters download here.</p>
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
	summary {
		list-style: none;
		margin-bottom: 8px;
	}
	summary::-webkit-details-marker {
		display: none;
	}
	.meta {
		display: block;
	}
	.small {
		font-size: 13px;
	}
	.ok {
		color: var(--ok);
	}
	.choice {
		margin: 0;
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(min(100%, 260px), 1fr));
		gap: 8px 16px;
		font-size: 14px;
	}
	dt {
		font-size: 12px;
		color: var(--muted);
	}
	dd {
		margin: 0;
		overflow-wrap: anywhere;
	}
	.warnings {
		margin: 0;
		padding-left: 18px;
		font-size: 14px;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.night {
		display: flex;
		flex-direction: column;
		gap: 6px;
		padding-top: 8px;
		border-top: 1px solid var(--border);
	}
	.list {
		margin: 0;
		padding: 0;
		list-style: none;
		display: flex;
		flex-direction: column;
	}
	.list li {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 8px 0;
		border-top: 1px solid var(--border);
	}
	.list li:first-child {
		border-top: 0;
	}
	.list .tag {
		flex: none;
		width: 44px;
		text-align: center;
	}
	.body {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
		font-size: 14px;
	}
	.sets {
		display: grid;
		gap: var(--gap);
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 360px), 1fr));
	}
</style>
