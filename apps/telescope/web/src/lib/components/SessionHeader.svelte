<script lang="ts">
	import Card from './Card.svelte';
	import { clock, formatAgo, formatDuration, nightLabel } from '$lib/format';
	import type { SessionDetail, Status } from '$lib/types';

	/**
	 * The Live page's head: the ASIAIR's connection, the target and plan progress, what the ASIAIR is doing (the
	 * exposure counting up like the dashboard's Telescope tab), the estimated finish, and the session's numbers.
	 */
	let {
		status,
		session,
		nowS,
		finish,
		dawn = null,
		failedSince
	}: {
		status: Status | null;
		session: SessionDetail | null;
		nowS: number;
		finish: { target: number | null; plan: number | null };
		/** End of tonight's darkness (unix ms), if known. */
		dawn?: number | null;
		failedSince: number | null;
	} = $props();
	/** A finish after dawn is not a time the plan will reach tonight: say dawn comes first. */
	const pastDawn = (s: number) => dawn !== null && s * 1000 > dawn;

	const live = $derived(status?.live?.connected ? status.live : null);
	const plan = $derived(session?.active ? live?.plan : null);
	const done = $derived(plan?.targetDone ?? session?.plan?.current ?? null);
	const total = $derived(plan?.targetTotal ?? session?.plan?.planned ?? null);
	const exposure = $derived.by(() => {
		const e = live?.exposure;
		if (!e?.totalS) return null;
		const elapsed = e.startedAt !== null ? nowS - e.startedAt : (e.elapsedS ?? 0);
		return { elapsedS: Math.max(0, Math.min(e.totalS, elapsed)), totalS: e.totalS };
	});
	const busy = $derived(live?.activity && live.activity !== 'Exposing' && live.activity !== 'Idle' ? live.activity : null);
	const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
</script>

<Card title={session?.active ? 'Now imaging' : session ? 'Last session' : 'Session'}>
	{#snippet accessory()}
		{#if status}
			<span class="link" class:off={!status.online}><i></i>{status.online ? 'ASIAIR online' : 'ASIAIR offline'}</span>
		{/if}
	{/snippet}
	{#if failedSince}<p class="warn small">The telescope service has not answered since {clock(failedSince)}.</p>{/if}
	{#if status && !status.online}
		<p class="warn small">Last contact {status.lastContact ? formatAgo(status.lastContact, nowS * 1000) : 'never'}{status.error ? ` · ${status.error}` : ''}</p>
	{/if}
	{#if !session}
		<p class="big">No imaging session</p>
		<p class="muted small">Sessions appear here as soon as the ASIAIR saves its first frame.</p>
	{:else}
		<div class="head">
			<h1>{session.target}</h1>
			<span class="muted">
				{plan?.targets && plan.targets > 1 ? `Target ${plan.targetIndex ?? '–'} of ${plan.targets} · ` : ''}{session.mode} · {nightLabel(session.night, false)}
			</span>
		</div>
		{#if session.active}
			<div class="state">
				{#if busy}
					<span class="busy">{busy}</span>
				{:else if exposure}
					<span class="num">Exposing <strong>{mmss(exposure.elapsedS)}</strong> / {mmss(exposure.totalS)}</span>
					<span class="bar" role="progressbar" aria-label="Exposure" aria-valuemin="0" aria-valuemax={exposure.totalS} aria-valuenow={Math.round(exposure.elapsedS)}>
						<span style:width="{(exposure.elapsedS / exposure.totalS) * 100}%"></span>
					</span>
				{:else if live}
					<span class="muted">{live.activity}</span>
				{:else}
					<span class="muted">No live state from the ASIAIR</span>
				{/if}
			</div>
		{/if}
		{#if total}
			<div class="progress" role="progressbar" aria-label="Frames" aria-valuemin="0" aria-valuemax={total} aria-valuenow={done ?? 0}>
				<span style:width="{Math.min(1, (done ?? 0) / total) * 100}%"></span>
			</div>
		{/if}
		<dl class="facts">
			<div><dt>Frames</dt><dd class="num">{total ? `${done ?? '–'} / ${total}` : session.frames.length}</dd></div>
			{#if plan?.planTotal && (plan.targets ?? 1) > 1}<div><dt>Whole plan</dt><dd class="num">{plan.planDone ?? '–'} / {plan.planTotal}</dd></div>{/if}
			<div><dt>In stack</dt><dd class="num">{session.accepted} <small class:warn={session.rejected > 0}>· {session.rejected} out</small></dd></div>
			<div><dt>Integration</dt><dd class="num">{formatDuration(session.integrationS)}</dd></div>
			{#if session.exposureS}<div><dt>Exposure</dt><dd class="num">{session.exposureS} s</dd></div>{/if}
			<div><dt>Last frame</dt><dd class="num">{formatAgo(session.lastFrameAt, nowS * 1000)}</dd></div>
			{#if finish.target}<div><dt>Target done</dt><dd class="num" class:warn={pastDawn(finish.target)}>{pastDawn(finish.target) ? `dawn ${clock(dawn!)} first` : `≈ ${clock(finish.target * 1000)}`}</dd></div>{/if}
			{#if finish.plan}<div><dt>Plan done</dt><dd class="num" class:warn={pastDawn(finish.plan)}>{pastDawn(finish.plan) ? `dawn ${clock(dawn!)} first` : `≈ ${clock(finish.plan * 1000)}`}</dd></div>{/if}
		</dl>
	{/if}
</Card>

<style>
	p {
		margin: 0;
	}
	.small {
		font-size: 13px;
	}
	.big {
		font-size: 20px;
		font-weight: 600;
	}
	.link {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		color: var(--ok);
		font-weight: 600;
	}
	.link.off {
		color: var(--warn);
	}
	.link i {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: currentColor;
	}
	.head {
		display: flex;
		align-items: baseline;
		flex-wrap: wrap;
		gap: 4px 12px;
	}
	h1 {
		margin: 0;
		font-size: 28px;
		font-weight: 700;
		letter-spacing: -0.02em;
	}
	.head span {
		font-size: 14px;
	}
	.state {
		display: flex;
		align-items: center;
		gap: 12px;
		font-size: 15px;
	}
	.busy {
		color: var(--warn);
		font-weight: 600;
	}
	.bar,
	.progress {
		flex: 1;
		height: 6px;
		border-radius: 3px;
		background: var(--surface-strong);
		overflow: hidden;
		display: block;
	}
	.bar span,
	.progress span {
		display: block;
		height: 100%;
		background: var(--accent);
	}
	.progress span {
		background: var(--ok);
	}
	.facts {
		margin: 0;
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
		gap: 10px 16px;
	}
	dt {
		font-size: 12px;
		color: var(--muted);
	}
	dd {
		margin: 2px 0 0;
		font-size: 17px;
		font-weight: 600;
		white-space: nowrap;
	}
	dd small {
		font-size: 12px;
		font-weight: 500;
		color: var(--muted);
	}
	dd small.warn {
		color: var(--warn);
	}
</style>
