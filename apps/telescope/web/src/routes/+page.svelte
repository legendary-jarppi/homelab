<script lang="ts">
	import { untrack } from 'svelte';
	import Card from '$lib/components/Card.svelte';
	import FrameList from '$lib/components/FrameList.svelte';
	import Guiding from '$lib/components/Guiding.svelte';
	import Quality from '$lib/components/Quality.svelte';
	import SessionHeader from '$lib/components/SessionHeader.svelte';
	import StackView from '$lib/components/StackView.svelte';
	import Telemetry from '$lib/components/Telemetry.svelte';
	import Timeline from '$lib/components/Timeline.svelte';
	import { estimateFinish } from '$lib/eta';
	import { nightNoon, sky } from '$lib/sky';
	import { formatAgo, formatDuration } from '$lib/format';
	import { now } from '$lib/now.svelte';
	import { SessionData, stackUrl } from '$lib/session.svelte';
	import type { AdviceReport, SessionSummary, Status } from '$lib/types';

	/**
	 * Live: the current session (or the most recent one): stack, head, timeline, guiding, frames, telemetry.
	 * Polls the status every 10 s, the session list every minute, and the session's report every 30 s or as soon
	 * as the status shows a new frame or a new stack.
	 */
	let { data } = $props();

	// Seeded from the load, then replaced by the polls.
	let status = $state.raw<Status | null>(untrack(() => data.status));
	let sessions = $state.raw<SessionSummary[] | null>(untrack(() => data.sessions));
	let failedSince = $state<number | null>(null);
	const session = new SessionData();

	const STATUS_MS = 10_000;
	const SESSIONS_MS = 60_000;
	const DETAIL_MS = 30_000;
	/** R6: calibration reminders (the server rebuilds them at most every 10 min). */
	const ADVICE_MS = 600_000;
	let advice = $state.raw<AdviceReport | null>(null);
	/** What is due: the reminders that are warnings (flats before turning the camera, missing darks or bias). */
	const due = $derived(advice?.calibration.filter((c) => c.level === 'warn') ?? []);

	const sessionId = $derived(status?.stack?.sessionId ?? sessions?.[0]?.id ?? null);
	/** Changes when the service has something new for the session: a frame, a restack. */
	const freshness = $derived(`${sessionId} ${status?.stack?.imageId ?? ''} ${status?.session?.lastFrameAt ?? ''} ${status?.session?.frames ?? ''}`);
	const detail = $derived(session.detail && session.detail.id === sessionId ? session.detail : null);
	const live = $derived(status?.live?.connected ? status.live : null);
	const nowS = $derived(now.ms / 1000);
	const finish = $derived(estimateFinish(detail, live));
	/** End of tonight's darkness (astronomical, else nautical): a finish later than this will not happen. */
	const dawn = $derived.by(() => {
		const where = detail?.site ?? data.site;
		if (!detail || !where) return null;
		const night = sky(where.lat, where.lon, nightNoon(detail.night));
		return night.astronomical?.end ?? night.nautical?.end ?? null;
	});
	const stack = $derived(detail?.stack ?? (status?.stack?.sessionId === sessionId ? status?.stack : null) ?? null);
	const latest = $derived(detail?.frames.at(-1) ?? null);

	async function refreshStatus() {
		try {
			const response = await fetch('/api/status');
			if (!response.ok) throw new Error(`HTTP ${response.status}`);
			status = (await response.json()) as Status;
			failedSince = null;
		} catch {
			failedSince ??= Date.now();
		}
	}
	async function refreshSessions() {
		try {
			const response = await fetch('/api/sessions');
			if (response.ok) sessions = (await response.json()) as SessionSummary[];
		} catch {
			// The status poll reports the service being away.
		}
	}
	async function refreshAdvice() {
		try {
			const response = await fetch('/api/advice');
			if (response.ok) advice = (await response.json()) as AdviceReport;
		} catch {
			// Not shown without it.
		}
	}

	$effect(() => now.use());
	$effect(() => {
		void refreshAdvice();
		const timers = [setInterval(refreshStatus, STATUS_MS), setInterval(refreshSessions, SESSIONS_MS), setInterval(refreshAdvice, ADVICE_MS)];
		return () => timers.forEach(clearInterval);
	});
	$effect(() => {
		void freshness;
		const id = sessionId;
		if (!id) return;
		session.load(id);
		const timer = setInterval(() => session.load(id), DETAIL_MS);
		return () => clearInterval(timer);
	});
</script>

<svelte:head><title>{detail ? `${detail.target} · ` : ''}Telescope</title></svelte:head>

<main class="live" class:single={!sessionId}>
	<div class="left">
		{#if !data.status && !status}
			<div class="stack"><Card title="Stack"><p class="muted">Telescope service unavailable.</p></Card></div>
		{:else if sessionId}
			<div class="stack">
				<Card title="Stack">
					{#snippet accessory()}
						{#if stack}<span class="num">{stack.accepted} frames · {formatDuration(stack.integrationS)}</span>{/if}
					{/snippet}
					<StackView
						{sessionId}
						stack={stack || detail?.hasStack ? stackUrl(sessionId, stack?.imageId) : null}
						frame={latest ? `/frames/${latest.id}.jpg` : null}
						alt="Stack of {detail?.target ?? stack?.target ?? 'the session'}"
					>
						{#snippet caption()}
							{#if stack}
								<span class="muted">Restacked {stack.updatedAt ? formatAgo(stack.updatedAt, now.ms) : ''}{stack.rejected ? ` · ${stack.rejected} frames left out` : ''}{latest ? ` · latest frame #${latest.number ?? ''}` : ''}</span>
							{/if}
						{/snippet}
					</StackView>
				</Card>
			</div>
		{/if}
		{#if detail}
			<div class="frames"><FrameList sessionId={detail.id} frames={detail.frames} pending={detail.pending} onchanged={() => (session.load(detail.id), refreshStatus())} /></div>
		{/if}
	</div>
	<div class="right">
		<div class="head">
			<SessionHeader {status} session={detail} {nowS} {finish} {dawn} {failedSince} />
			{#if due.length}
				<p class="todo small"><a href="/library">Calibration</a>: {due[0].text.split(': ')[0]}{due.length > 1 ? ` (+${due.length - 1} more)` : ''}</p>
			{/if}
		</div>
		{#if session.error && !detail && sessionId}
			<div class="timeline"><Card title="Session"><p class="warn">Session report unavailable: {session.error}</p></Card></div>
		{/if}
		{#if detail}
			<div class="timeline"><Timeline session={detail} site={data.site} {nowS} finishS={finish.target} /></div>
			<div class="guiding">
				<Guiding guiding={detail.guiding} frames={detail.frames} live={detail.active ? live?.guiding : null} wind={session.wind} windError={session.windError} />
			</div>
		{/if}
		{#if detail || live}
			<div class="telemetry">
				<Telemetry telemetry={detail?.telemetry ?? null} live={detail?.active || !detail ? live : null} storage={status?.storage} />
			</div>
		{/if}
		{#if detail}<div class="quality"><Quality frames={detail.frames} /></div>{/if}
	</div>
</main>

<style>
	p {
		margin: 0;
	}
	/* Phone: one column, the head first, the stack under it. */
	.live,
	.left,
	.right {
		display: flex;
		flex-direction: column;
		gap: var(--gap);
		min-width: 0;
	}
	.left,
	.right {
		display: contents;
	}
	.head {
		order: 1;
	}
	.todo {
		margin-top: 8px;
		font-size: 13px;
		color: var(--warn);
	}
	.stack {
		order: 2;
	}
	.timeline {
		order: 3;
	}
	.guiding {
		order: 4;
	}
	.frames {
		order: 5;
	}
	.telemetry {
		order: 6;
	}
	.quality {
		order: 7;
	}
	.live div {
		min-width: 0;
	}
	/* Laptop: the stack and the frames on the left, the rest beside them. */
	@media (min-width: 1000px) {
		.live {
			display: grid;
			grid-template-columns: minmax(0, 1.05fr) minmax(0, 1fr);
			align-items: start;
		}
		.left,
		.right {
			display: flex;
		}
		.live.single {
			grid-template-columns: minmax(0, 720px);
		}
	}
</style>
