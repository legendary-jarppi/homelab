<script lang="ts">
	import Framing from './Framing.svelte';
	import FramingDialog from './FramingDialog.svelte';
	import { formatDuration, nightLabel } from '$lib/format';
	import { FAINT_SB, SB_GROUPS, SNR_TARGET, meanSurfaceBrightness, roughDuration, targetEstimate, type TargetEstimate } from '$lib/exposure';
	import type { TargetProgress } from '$lib/goals';
	import { DEFAULT_MIN_ALTITUDE, placement, planTarget, type NightPlan } from '$lib/planner';
	import type { TargetStore } from '$lib/targets.svelte';
	import type { Final } from '$lib/types';

	/**
	 * C5: one target's integration against its goal (editable), nights imaged, tonight's placement and the
	 * latest final stack. `compact` for the session report (no box, session links or final: the report shows those itself).
	 */
	let { row, store, night, finals, compact = false }: { row: TargetProgress; store: TargetStore; night: NightPlan | null; finals: Final[]; compact?: boolean } = $props();

	const goalHours = $derived(row.goal?.goalHours ?? null);
	const fraction = $derived(goalHours ? Math.min(1, row.integrationS / (goalHours * 3600)) : null);
	const leftS = $derived(goalHours ? goalHours * 3600 - row.integrationS : null);
	const tonight = $derived(night && row.ra !== null && row.dec !== null ? placement(planTarget({ ra: row.ra, dec: row.dec }, night, DEFAULT_MIN_ALTITUDE), night.sky.moon.illumination) : null);
	const final = $derived(finals.find((f) => row.targetNames.includes(f.target)));
	const wished = $derived(row.goal?.wishlist ?? false);
	/** R6: the integration for SNR 10 per pixel at faint nebulosity and at the catalog's mean surface brightness, from the target's measured sessions. */
	const faint = $derived(targetEstimate(row.sessions, FAINT_SB));
	const catalogSb = $derived(row.dso && SB_GROUPS[row.dso.group] ? meanSurfaceBrightness(row.dso.mag, row.dso.maj, row.dso.min) : null);
	const own = $derived(catalogSb !== null ? targetEstimate(row.sessions, catalogSb) : null);
	/** B3: the framing on the survey, open. */
	let survey = $state(false);

	function setGoal(text: string) {
		const value = text.trim() === '' ? null : Number(text);
		if (value !== null && (!Number.isFinite(value) || value <= 0 || value > 1000)) return;
		if (value !== goalHours) store.save(row.key, { goalHours: value });
	}
</script>

{#snippet needed(e: TargetEstimate, sb: number, what: string)}
	<span
		>SNR {SNR_TARGET} per pixel at {sb.toFixed(1)} mag/″² ({what}): {roughDuration(e.totalS)} in all at the last sky ({e.sky.skyMag.toFixed(1)} mag/″², {e.sky.subS} s subs); has
		{formatDuration(row.integrationS - e.unmeasuredS)} (SNR {e.snrNow.toFixed(1)}){#if e.moreS > 0}, <span class="muted">{roughDuration(e.moreS)} more</span>{:else}, <span class="ok">reached</span>{/if}</span
	>
{/snippet}

<article class="goal" class:compact id={compact ? undefined : `target-${row.key}`}>
	<div class="head">
		{#if row.dso}<button class="hint" onclick={() => (survey = true)} aria-label="Framing of {row.dso.id} on a survey image" title="Framing on a survey image"><Framing maj={row.dso.maj} min={row.dso.min} size={40} /></button>{/if}
		<div class="name">
			<strong>{row.key}</strong>{#if row.dso?.names[0]}<span class="muted"> {row.dso.names[0]}</span>{/if}
			{#if row.targetNames.length && !(row.targetNames.length === 1 && row.targetNames[0] === row.key)}
				<span class="small faint">as {row.targetNames.join(', ')}</span>
			{/if}
		</div>
		<button class="star" class:on={wished} disabled={store.busy === row.key} onclick={() => store.save(row.key, { wishlist: !wished })} aria-pressed={wished} aria-label="{wished ? 'Remove from' : 'Add to'} wishlist">
			<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.2l2.7 5.6 6.1.8-4.5 4.2 1.1 6.1L12 17l-5.4 2.9 1.1-6.1-4.5-4.2 6.1-.8z" fill={wished ? 'currentColor' : 'none'} stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" /></svg>
		</button>
	</div>

	<div class="numbers">
		<span class="big num">{formatDuration(row.integrationS)}</span>
		{#if goalHours}<span class="muted num">of {goalHours} h</span>{/if}
		<label class="edit small muted">Goal <input class="field num" type="number" min="0.5" max="1000" step="0.5" placeholder="–" value={goalHours ?? ''} onchange={(e) => setGoal(e.currentTarget.value)} disabled={store.busy === row.key} /> h</label>
	</div>
	{#if fraction !== null}
		<div class="progress" role="progressbar" aria-label="Progress towards the goal" aria-valuemin="0" aria-valuemax="1" aria-valuenow={fraction}><span class:done={fraction >= 1} style:width="{fraction * 100}%"></span></div>
		<span class="small" class:ok={leftS !== null && leftS <= 0}>{leftS !== null && leftS > 0 ? `Needs ${(leftS / 3600).toFixed(1)} h more (${Math.round(fraction * 100)} %)` : 'Goal reached'}</span>
	{/if}

	<div class="facts small">
		<span>{row.nights.length ? `${row.nights.length} ${row.nights.length === 1 ? 'night' : 'nights'}, last ${nightLabel(row.lastNight!)}` : 'Not imaged yet'}</span>
		{#if tonight}<span>Tonight: <span class:ok={tonight.good} class:muted={!tonight.good}>{tonight.text}</span></span>{/if}
		{#if final && !compact}
			<span>Final: <a href="/finals#final-{final.id}"><span class="tag" class:ok={final.status === 'done'} class:bad={final.status === 'failed'} class:accent={final.status === 'running'}>{final.status}</span></a>
				{final.nights.length} {final.nights.length === 1 ? 'night' : 'nights'}, {formatDuration(final.integrationS)}{final.status === 'running' && final.progress ? ` · ${final.progress}` : ''}</span>
		{/if}
		{#if faint}
			{@render needed(faint, FAINT_SB, 'faint nebulosity')}
			{#if own && catalogSb !== null}{@render needed(own, catalogSb, 'its catalog mean')}{/if}
			{#if faint.unmeasuredS > 0}<span class="faint">{formatDuration(faint.unmeasuredS)} from sessions without a measured sky not counted</span>{/if}
		{:else if row.sessions.length}
			<span class="faint">Integration needed: no measured sky in its sessions yet (measured in plate-solved frames after the bias frames are read)</span>
		{/if}
	</div>

	<div class="links">
		{#if !compact}
			{#each row.sessions.slice(-4).reverse() as s (s.id)}<a class="btn" href="/sessions/{s.id}">{nightLabel(s.night, false)}</a>{/each}
			{#if row.sessions.length > 4}<span class="small faint">+{row.sessions.length - 4}</span>{/if}
		{/if}
		{#if row.dso}<a class="btn" href="/planner?q={encodeURIComponent(row.dso.id)}">Plan</a>{#if !compact}<button class="btn" onclick={() => (survey = true)}>Framing</button>{/if}{/if}
		{#if row.targetNames[0] && !compact}<a class="btn" href="/finals?target={encodeURIComponent(row.targetNames[0])}">Final stack</a>{/if}
	</div>
</article>

{#if survey && row.dso}<FramingDialog dso={row.dso} onclose={() => (survey = false)} />{/if}

<style>
	.goal {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 13px 15px;
		height: 100%;
		border-radius: 18px;
		background: var(--surface);
		border: 1px solid var(--border);
		scroll-margin-top: 20px;
	}
	.goal.compact {
		padding: 0;
		background: none;
		border: 0;
	}
	.goal:target {
		border-color: var(--accent);
	}
	.head {
		display: flex;
		align-items: center;
		gap: 10px;
	}
	.hint {
		flex: none;
		padding: 0;
		border: 0;
		background: none;
		cursor: zoom-in;
	}
	.name {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		font-size: 17px;
	}
	.name .muted {
		font-size: 14px;
	}
	.small {
		font-size: 13px;
	}
	.star {
		flex: none;
		width: 40px;
		height: 40px;
		display: grid;
		place-items: center;
		border: 0;
		background: none;
		color: var(--muted);
		cursor: pointer;
	}
	.star svg {
		width: 22px;
		height: 22px;
	}
	.star.on {
		color: var(--warn);
	}
	.numbers {
		display: flex;
		align-items: baseline;
		flex-wrap: wrap;
		gap: 4px 8px;
	}
	.big {
		font-size: 24px;
		font-weight: 650;
	}
	.edit {
		margin-left: auto;
		display: inline-flex;
		align-items: center;
		gap: 5px;
	}
	.edit .field {
		width: 72px;
		padding: 4px 8px;
	}
	.ok {
		color: var(--ok);
	}
	.facts {
		display: flex;
		flex-direction: column;
		gap: 3px;
	}
	.facts a {
		text-decoration: none;
	}
	.links {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 6px;
		margin-top: auto;
	}
</style>
