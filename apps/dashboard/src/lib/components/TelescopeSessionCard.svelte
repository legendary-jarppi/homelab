<script lang="ts">
	import Card from './Card.svelte';
	import { clock, eventTime } from '$lib/dates';
	import { formatDuration } from '$lib/format';
	import { night } from '$lib/night.svelte';
	import type { TelescopeData } from '$lib/types';

	/**
	 * The ASIAIR's connection, the running plan and the imaging session; with the ASIAIR's live state (`telescope.live`)
	 * also the frame being exposed (counted on each second from its start), what the ASIAIR is busy with between frames
	 * (a meridian flip or auto focus pauses frames for 10–20 min: the usual reason no new frame arrives), the target
	 * within a multi-target plan, and the ASIAIR's own temperature and Wi-Fi signal. `failedSince`: unix ms of the first
	 * failed refresh while the telescope service is not answering (the card keeps its last data).
	 */
	let { telescope, configured, failedSince }: { telescope: TelescopeData | null; configured: boolean; failedSince: number | null } = $props();

	/** A plan is shown while it runs and for 12 h after its last log line (the session's span). */
	const plan = $derived(
		telescope?.plan && (telescope.plan.state === 'running' || night.now.getTime() / 1000 - (telescope.plan.updatedAt ?? 0) < 12 * 3600) ? telescope.plan : null
	);
	const session = $derived(telescope?.session ?? null);
	const progress = $derived(plan?.planned ? Math.min(1, (plan.current ?? 0) / plan.planned) : null);
	const live = $derived(telescope?.live?.connected ? telescope.live : null);
	/** The frame being exposed; elapsed counted on from its start between polls, stopping at the exposure time. */
	const exposure = $derived.by(() => {
		const e = live?.exposure;
		if (!e?.totalS) return null;
		const elapsed = e.startedAt !== null ? night.now.getTime() / 1000 - e.startedAt : (e.elapsedS ?? 0);
		return { elapsedS: Math.max(0, Math.min(e.totalS, elapsed)), totalS: e.totalS };
	});
	/** Busy with something other than exposing (meridian flip, auto focus, GoTo …): no frames meanwhile. */
	const busy = $derived(live?.activity && live.activity !== 'Exposing' && live.activity !== 'Idle' ? live.activity : null);
	/** Activity text beside the plan state when it is not shown more prominently. */
	const activity = $derived(live ? (busy || exposure ? null : live.activity) : plan?.activity);
	const targets = $derived(live?.plan?.targets && live.plan.targets > 1 ? live.plan : null);
	const when = (unixS: number) => eventTime(new Date(unixS * 1000).toISOString(), night.now);
	const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
	const STATES: Record<string, string> = { running: 'Running', finished: 'Finished', stopped: 'Stopped' };
</script>

{#snippet accessory()}
	{#if telescope}
		<span class="link" class:off={!telescope.online}><i></i>{telescope.online ? 'ASIAIR online' : 'ASIAIR offline'}</span>
		{#if live?.controllerTempC != null}<span class="num" title="ASIAIR board temperature"> · {Math.round(live.controllerTempC)} °C</span>{/if}
		{#if live?.wifiDbm != null}<span class="num" title="ASIAIR Wi-Fi signal"> · Wi-Fi {live.wifiDbm} dBm</span>{/if}
	{/if}
{/snippet}

{#snippet now()}
	{#if busy}
		<span class="busy">{busy}</span>
	{:else if exposure}
		<span class="exposing num">Exposing <strong>{mmss(exposure.elapsedS)}</strong> / {mmss(exposure.totalS)}</span>
		<span class="bar" role="progressbar" aria-label="Exposure" aria-valuemin="0" aria-valuemax={exposure.totalS} aria-valuenow={Math.round(exposure.elapsedS)}>
			<span style:width="{(exposure.elapsedS / exposure.totalS) * 100}%"></span>
		</span>
	{/if}
{/snippet}

<Card title="Session" {accessory}>
	{#if !configured}
		<p class="muted">Telescope not set up.</p>
	{:else if !telescope}
		<p class="muted">Telescope unavailable{failedSince ? `: no answer since ${clock(failedSince)}` : ''}.</p>
	{:else}
		{#if failedSince}
			<p class="warn small">No fresh data: the telescope service has not answered since {clock(failedSince)}.</p>
		{/if}
		{#if !telescope.online}
			<p class="warn small">
				Last contact {telescope.lastContact ? when(telescope.lastContact) : 'never'}{telescope.error ? ` · ${telescope.error}` : ''}
			</p>
		{/if}

		{#if !plan && !session}
			<div class="calm">
				<p class="big">No imaging session</p>
				{#if telescope.frames[0]}<p class="muted">Last frame {when(telescope.frames[0].at)} · {telescope.frames[0].target}</p>{/if}
			</div>
			{#if busy || exposure}<div class="state">{@render now()}</div>{/if}
		{:else}
			<div class="head">
				<h3>{plan?.target ?? session?.target}</h3>
				{#if targets}
					<span class="muted">Target {targets.targetIndex ?? '–'} of {targets.targets}{plan?.name ? ` · plan ${plan.name}` : ''}</span>
				{:else if plan?.name}<span class="muted">plan {plan.name}</span>{:else if session}<span class="muted">{session.mode}</span>{/if}
			</div>
			{#if plan}
				<div class="state">
					<span class="badge" class:running={plan.state === 'running'}>{STATES[plan.state] ?? plan.state}</span>
					{#if busy || exposure}{@render now()}{:else if activity && activity !== STATES[plan.state]}<span>{activity}</span>{/if}
				</div>
				{#if progress !== null}
					<div class="progress" role="progressbar" aria-label="Frames" aria-valuemin="0" aria-valuemax={plan.planned} aria-valuenow={plan.current ?? 0}>
						<span style:width="{progress * 100}%"></span>
					</div>
				{/if}
			{:else if busy || exposure}
				<div class="state">{@render now()}</div>
			{/if}
			<dl class="facts">
				{#if plan?.planned}
					<div><dt>Frames</dt><dd class="num">{plan.current ?? '–'} / {plan.planned}</dd></div>
				{:else if session}
					<div><dt>Frames</dt><dd class="num">{session.frames}</dd></div>
				{/if}
				{#if targets?.planTotal}
					<div><dt>Whole plan</dt><dd class="num">{targets.planDone ?? '–'} / {targets.planTotal}</dd></div>
				{/if}
				{#if session}
					<div><dt>Integration</dt><dd class="num">{formatDuration(session.integrationS)}</dd></div>
				{/if}
				{#if !exposure && (plan?.exposureS ?? session?.exposureS)}
					<div><dt>Exposure</dt><dd class="num">{plan?.exposureS ?? session?.exposureS} s</dd></div>
				{/if}
				{#if session}
					<div><dt>Last frame</dt><dd class="num">{when(session.lastFrameAt)}</dd></div>
				{/if}
			</dl>
			{#if plan && plan.events.length > 0}
				<ol class="events">
					{#each plan.events as e, i (i)}
						<li><span class="num muted">{clock(e.at * 1000)}</span><span>{e.text}</span></li>
					{/each}
				</ol>
			{/if}
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
	.warn {
		color: var(--warn);
	}
	.link {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-weight: 600;
		color: var(--ok);
	}
	.link.off {
		color: var(--warn);
	}
	.link i {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: currentColor;
		box-shadow: 0 0 8px currentColor;
	}
	.calm {
		flex: 1;
		display: grid;
		align-content: center;
		justify-items: center;
		gap: 6px;
		padding: 18px 0;
		text-align: center;
	}
	.big {
		font-size: 18px;
		font-weight: 600;
		color: var(--muted);
	}
	.head {
		display: flex;
		align-items: baseline;
		flex-wrap: wrap;
		gap: 4px 10px;
	}
	h3 {
		margin: 0;
		font-size: 22px;
		font-weight: 650;
		letter-spacing: -0.01em;
	}
	.head .muted {
		font-size: 14px;
	}
	.state {
		display: flex;
		align-items: center;
		gap: 10px;
		font-size: 15px;
		font-weight: 600;
	}
	.badge {
		padding: 3px 10px;
		font-size: 12px;
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		border-radius: 999px;
		color: var(--muted);
		background: var(--surface-strong);
	}
	.badge.running {
		color: var(--ok);
		background: rgba(52, 211, 153, 0.12);
	}
	/* Frames are paused (flip, focus, GoTo) for a while: the usual reason no new frame arrives, so it stands out. */
	.busy {
		padding: 2px 12px;
		font-size: 17px;
		font-weight: 650;
		color: var(--warn);
		background: rgba(251, 191, 36, 0.12);
		border-radius: 999px;
	}
	.progress {
		height: 8px;
		border-radius: 999px;
		background: var(--surface-strong);
		overflow: hidden;
	}
	.progress span {
		display: block;
		height: 100%;
		border-radius: inherit;
		background: var(--ok);
	}
	.exposing {
		white-space: nowrap;
		font-weight: 500;
		color: var(--muted);
	}
	.exposing strong {
		color: var(--text);
		font-weight: 600;
	}
	/* The frame being exposed: a thin bar, so it does not compete with the frames bar. */
	.bar {
		flex: 1;
		min-width: 40px;
		height: 3px;
		border-radius: 999px;
		background: var(--surface-strong);
		overflow: hidden;
	}
	.bar span {
		display: block;
		height: 100%;
		background: var(--down);
		transition: width 1s linear;
	}
	.facts {
		margin: 0;
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(78px, 1fr));
		gap: 10px 16px;
	}
	dt {
		font-size: 12px;
		color: var(--muted);
	}
	dd {
		margin: 2px 0 0;
		font-size: 15px;
		font-weight: 550;
		white-space: nowrap;
	}
	.events {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		list-style: none;
		margin: 0;
		padding: 8px 0 0;
		display: grid;
		align-content: start;
		gap: 6px;
		border-top: 1px solid var(--border);
		font-size: 13px;
	}
	.events li {
		display: grid;
		grid-template-columns: 44px minmax(0, 1fr);
		gap: 8px;
	}
</style>
