<script lang="ts">
	import Card from './Card.svelte';
	import { clock } from '$lib/dates';
	import type { TonightData } from '$lib/types';

	/** Darkness, moon and clouds tonight at the telescope site. `configured`: TELESCOPE_SITE is set. */
	let { tonight, configured }: { tonight: TonightData | null; configured: boolean } = $props();

	const HOUR = 3_600_000;
	/** Total cloud cover at or below this counts as clear. */
	const CLEAR = 30;
	/** Air within this many degrees of its dew point: the optics will likely dew up. */
	const DEW_MARGIN = 2;

	/** Astronomical darkness, or nautical in the light half of the year. */
	const dark = $derived(tonight ? (tonight.astronomical ?? tonight.nautical) : null);
	/** The part of the night the verdict judges: darkness, else sunset to sunrise. */
	const span = $derived(
		tonight ? (dark ?? (tonight.sunset && tonight.sunrise ? { start: tonight.sunset, end: tonight.sunrise } : null)) : null
	);
	const dewRisk = (h: NonNullable<TonightData['hours']>[number]) => h.temperature !== null && h.dewPoint !== null && h.temperature - h.dewPoint <= DEW_MARGIN;

	const moonName = $derived.by(() => {
		const p = tonight?.moon.phase ?? 0;
		if (p < 0.03 || p > 0.97) return 'New moon';
		if (p < 0.22) return 'Waxing crescent';
		if (p < 0.28) return 'First quarter';
		if (p < 0.47) return 'Waxing gibbous';
		if (p < 0.53) return 'Full moon';
		if (p < 0.72) return 'Waning gibbous';
		if (p < 0.78) return 'Last quarter';
		return 'Waning crescent';
	});

	/** Lit part of the moon as seen from the north: a limb arc and the terminator's half-ellipse. */
	const moonPath = $derived.by(() => {
		const k = tonight?.moon.illumination ?? 0;
		const waxing = (tonight?.moon.phase ?? 0) < 0.5;
		const rx = 10 * Math.abs(1 - 2 * k);
		const limb = waxing ? 1 : 0;
		const terminator = waxing === k > 0.5 ? 1 : 0;
		return `M0,-10 A10,10 0 0 ${limb} 0,10 A${rx},10 0 0 ${terminator} 0,-10 Z`;
	});

	/** "Clear 22–03, moon sets 23:40, dew likely". */
	const verdict = $derived.by(() => {
		if (!tonight || !span) return null;
		const parts: string[] = dark ? [] : ['No darkness'];
		const hours = (tonight.hours ?? []).filter((h) => h.time + HOUR > span.start && h.time < span.end && h.cloud !== null);
		if (hours.length > 0) {
			// Longest run of clear hours.
			let best: { from: number; to: number } | null = null;
			let run: { from: number; to: number } | null = null;
			for (const h of hours) {
				if ((h.cloud ?? 100) <= CLEAR) {
					run = run ? { from: run.from, to: h.time + HOUR } : { from: h.time, to: h.time + HOUR };
					if (!best || run.to - run.from > best.to - best.from) best = run;
				} else run = null;
			}
			if (!best) parts.push(hours.every((h) => (h.cloud ?? 0) >= 80) ? 'Overcast' : 'Cloudy');
			else if (best.to - best.from >= hours.length * HOUR) parts.push('Clear all night');
			else parts.push(`Clear ${clock(Math.max(best.from, span.start)).slice(0, 2)}–${clock(Math.min(best.to, span.end)).slice(0, 2)}`);
			if (hours.some(dewRisk)) parts.push('dew likely');
		}
		const moonEvents = tonight.moon.events.filter((e) => e.at > span.start && e.at < span.end);
		const percent = `${Math.round(tonight.moon.illumination * 100)}%`;
		if (moonEvents.length > 0) parts.push(moonEvents.map((e) => `moon ${e.kind === 'rise' ? 'rises' : 'sets'} ${clock(e.at)}`).join(', ') + ` (${percent})`);
		else parts.push(tonight.moon.upAtDark ? `moon up all night (${percent})` : 'no moon');
		const text = parts.join(', ');
		return text.charAt(0).toUpperCase() + text.slice(1);
	});
	const range = (w: { start: number; end: number }) => `${clock(w.start)}–${clock(w.end)}`;
</script>

{#snippet accessory()}
	{#if tonight}<span>{tonight.site.name}</span>{/if}
{/snippet}

<Card title="Tonight at the cabin" {accessory}>
	{#if !configured}
		<p class="muted">Telescope site not set up.</p>
	{:else if !tonight}
		<p class="muted">Sky forecast unavailable.</p>
	{:else}
		{#if verdict}<p class="verdict">{verdict}</p>{/if}
		<dl class="facts">
			<div>
				<dt>Darkness <span class="faint">sun below −18°</span></dt>
				{#if tonight.astronomical}
					<dd class="num">{range(tonight.astronomical)}</dd>
				{:else if tonight.nautical}
					<dd>None tonight <span class="muted num">· nautical (−12°) {range(tonight.nautical)}</span></dd>
				{:else}
					<dd>None tonight <span class="muted num">· bright night, sun lowest {tonight.sunLowest.toFixed(0).replace('-', '−')}°</span></dd>
				{/if}
			</div>
			<div>
				<dt>Sun</dt>
				<dd class="num">sets {tonight.sunset ? clock(tonight.sunset) : '–'} · rises {tonight.sunrise ? clock(tonight.sunrise) : '–'}</dd>
			</div>
			<div class="moon">
				<dt>Moon</dt>
				<dd>
					<svg viewBox="-11 -11 22 22" aria-hidden="true"><circle r="10" class="dark" /><path d={moonPath} class="lit" /></svg>
					<span>{moonName} <span class="num">{Math.round(tonight.moon.illumination * 100)}%</span>
						{#if tonight.moon.events.length > 0}<span class="muted num"
								>· {tonight.moon.events.map((e) => `${e.kind === 'rise' ? 'rises' : 'sets'} ${clock(e.at)}`).join(' · ')}</span
							>{/if}</span
					>
				</dd>
			</div>
		</dl>
		{#if tonight.hours && tonight.hours.length > 0}
			<!-- Sunset to sunrise, hour by hour: total cloud bar (green when clear), low/mid/high cloud as shades, temperature and dew point (amber: dew likely). -->
			<div class="hours" role="table" aria-label="Hourly clouds, temperature and dew point">
				<div class="col names" aria-hidden="true">
					<span class="bar-name">Clouds</span><span title="Low clouds">low</span><span title="Mid clouds">mid</span><span title="High clouds">high</span><span></span><span>°C</span><span>Dew</span>
				</div>
				{#each tonight.hours as h (h.time)}
					<div
						class="col"
						class:light={!dark || h.time + HOUR <= dark.start || h.time >= dark.end}
						role="row"
						aria-label="{clock(h.time)}: clouds {h.cloud ?? '–'}% (low {h.low ?? '–'}, mid {h.mid ?? '–'}, high {h.high ?? '–'}), {h.temperature ?? '–'}°, dew point {h.dewPoint ?? '–'}°"
					>
						<span class="bar" title="{h.cloud ?? '–'}%"><span style:height="{h.cloud ?? 0}%" class:clear={(h.cloud ?? 100) <= CLEAR}></span></span>
						{#each [h.low, h.mid, h.high] as layer, i (i)}
							<span class="layer" style:background="rgba(148, 163, 184, {Math.max(0.06, (layer ?? 0) / 100)})"></span>
						{/each}
						<span class="num muted hh">{clock(h.time).slice(0, 2)}</span>
						<span class="num">{h.temperature === null ? '–' : Math.round(h.temperature)}°</span>
						<span class="num faint" class:warn={dewRisk(h)}>{h.dewPoint === null ? '–' : Math.round(h.dewPoint)}°</span>
					</div>
				{/each}
			</div>
		{:else if tonight.weatherError}
			<p class="muted small">Cloud forecast unavailable ({tonight.weatherError}).</p>
		{/if}
	{/if}
</Card>

<style>
	p {
		margin: 0;
		font-size: 14px;
	}
	.small {
		font-size: 13px;
	}
	.faint {
		color: var(--faint);
	}
	.warn {
		color: var(--warn);
	}
	.verdict {
		font-size: 17px;
		font-weight: 600;
		line-height: 1.3;
	}
	.facts {
		margin: 0;
		display: grid;
		grid-template-columns: repeat(2, minmax(0, auto));
		justify-content: start;
		gap: 8px 24px;
	}
	.facts .moon {
		grid-column: 1 / -1;
	}
	dt {
		font-size: 12px;
		color: var(--muted);
	}
	dd {
		margin: 2px 0 0;
		font-size: 15px;
		font-weight: 550;
	}
	dd .muted {
		font-weight: 500;
		font-size: 13px;
	}
	.moon dd {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.moon svg {
		flex: none;
		width: 22px;
		height: 22px;
	}
	.moon .dark {
		fill: rgba(255, 255, 255, 0.1);
	}
	.moon .lit {
		fill: #e5e7eb;
	}
	.hours {
		flex: 1 1 auto;
		min-height: 110px;
		margin-top: 4px;
		display: flex;
		gap: 2px;
		overflow-x: auto;
		padding-top: 10px;
		border-top: 1px solid var(--border);
		scrollbar-width: none;
	}
	.hours::-webkit-scrollbar {
		display: none;
	}
	/* One column per hour; the first column names the rows. */
	.col {
		flex: 1 0 19px;
		display: grid;
		grid-template-rows: minmax(40px, 1fr) 8px 8px 8px auto auto auto;
		gap: 2px;
		justify-items: center;
		font-size: 12px;
	}
	.col.names {
		flex: none;
		justify-items: start;
		padding-right: 4px;
		font-size: 9px;
		line-height: 8px;
		color: var(--faint);
	}
	.col.names span:nth-child(n + 5) {
		font-size: 11px;
		line-height: normal;
	}
	.bar-name {
		align-self: end;
		line-height: normal;
	}
	/* Hours outside darkness. */
	.col.light {
		opacity: 0.45;
	}
	.bar {
		width: 100%;
		display: flex;
		align-items: flex-end;
		border-radius: 5px;
		background: var(--surface-strong);
		overflow: hidden;
	}
	.bar span {
		width: 100%;
		background: #94a3b8;
	}
	.bar span.clear {
		background: var(--ok);
	}
	.layer {
		width: 100%;
		border-radius: 1px;
	}
	.hh {
		margin-top: 2px;
	}
</style>
