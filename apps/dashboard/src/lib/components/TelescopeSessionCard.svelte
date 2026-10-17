<script lang="ts">
	import Card from './Card.svelte';
	import { clock, eventTime } from '$lib/dates';
	import { formatDuration } from '$lib/format';
	import { night } from '$lib/night.svelte';
	import type { TelescopeData } from '$lib/types';

	/**
	 * The ASIAIR's connection, the running plan and the imaging session. `failedSince`: unix ms of the first
	 * failed refresh while the telescope service is not answering (the card keeps its last data).
	 */
	let { telescope, configured, failedSince }: { telescope: TelescopeData | null; configured: boolean; failedSince: number | null } = $props();

	/** A plan is shown while it runs and for 12 h after its last log line (the session's span). */
	const plan = $derived(
		telescope?.plan && (telescope.plan.state === 'running' || night.now.getTime() / 1000 - (telescope.plan.updatedAt ?? 0) < 12 * 3600) ? telescope.plan : null
	);
	const session = $derived(telescope?.session ?? null);
	const progress = $derived(plan?.planned ? Math.min(1, (plan.current ?? 0) / plan.planned) : null);
	const when = (unixS: number) => eventTime(new Date(unixS * 1000).toISOString(), night.now);
	const STATES: Record<string, string> = { running: 'Running', finished: 'Finished', stopped: 'Stopped' };
</script>

{#snippet accessory()}
	{#if telescope}
		<span class="link" class:off={!telescope.online}><i></i>{telescope.online ? 'ASIAIR online' : 'ASIAIR offline'}</span>
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
		{:else}
			<div class="head">
				<h3>{plan?.target ?? session?.target}</h3>
				{#if plan?.name}<span class="muted">plan {plan.name}</span>{:else if session}<span class="muted">{session.mode}</span>{/if}
			</div>
			{#if plan}
				<div class="state">
					<span class="badge" class:running={plan.state === 'running'}>{STATES[plan.state] ?? plan.state}</span>
					{#if plan.activity && plan.activity !== STATES[plan.state]}<span>{plan.activity}</span>{/if}
				</div>
				{#if progress !== null}
					<div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax={plan.planned} aria-valuenow={plan.current ?? 0}>
						<span style:width="{progress * 100}%"></span>
					</div>
				{/if}
			{/if}
			<dl class="facts">
				{#if plan?.planned}
					<div><dt>Frames</dt><dd class="num">{plan.current ?? '–'} / {plan.planned}</dd></div>
				{:else if session}
					<div><dt>Frames</dt><dd class="num">{session.frames}</dd></div>
				{/if}
				{#if session}
					<div><dt>Integration</dt><dd class="num">{formatDuration(session.integrationS)}</dd></div>
				{/if}
				{#if plan?.exposureS ?? session?.exposureS}
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
