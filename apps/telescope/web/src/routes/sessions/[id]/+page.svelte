<script lang="ts">
	import { untrack } from 'svelte';
	import Card from '$lib/components/Card.svelte';
	import FrameList from '$lib/components/FrameList.svelte';
	import Guiding from '$lib/components/Guiding.svelte';
	import Quality from '$lib/components/Quality.svelte';
	import SessionNumbers from '$lib/components/SessionNumbers.svelte';
	import StackView from '$lib/components/StackView.svelte';
	import Telemetry from '$lib/components/Telemetry.svelte';
	import Timeline from '$lib/components/Timeline.svelte';
	import { formatDuration, nightLabel } from '$lib/format';
	import { now } from '$lib/now.svelte';
	import { SessionData, stackUrl } from '$lib/session.svelte';

	/** D5: one session's report: stack, numbers and rejections, frame quality, guiding, telemetry, timeline, every frame. */
	let { data } = $props();

	const session = new SessionData(untrack(() => data.session));
	const d = $derived(session.detail && session.detail.id === data.session.id ? session.detail : data.session);
	// A newer stack or frame while the session is still running: refreshed every 30 s.
	const POLL_MS = 30_000;

	$effect(() => now.use());
	$effect(() => {
		const initial = data.session;
		const id = initial.id;
		untrack(() => {
			session.detail = initial;
			session.loadWind();
		});
		if (!initial.active) return;
		const timer = setInterval(() => session.load(id), POLL_MS);
		return () => clearInterval(timer);
	});
</script>

<svelte:head><title>{d.target} {d.night} · Telescope</title></svelte:head>

<main class="report">
	<div class="title">
		<a href="/sessions" class="back">← Sessions</a>
		<h1>{d.target}</h1>
		<span class="muted">{nightLabel(d.night)} · {d.mode}{d.active ? ' · imaging now' : ''}</span>
	</div>
	<div class="left">
		<div class="stack"><Card title="Stack">
			{#snippet accessory()}<span class="num">{d.accepted} frames · {formatDuration(d.integrationS)}</span>{/snippet}
			<StackView stack={d.hasStack || d.stack ? stackUrl(d.id, d.stack?.imageId ?? `${d.lastFrameAt}-${d.accepted}`) : null} frame={d.frames.at(-1) ? `/frames/${d.frames.at(-1)!.id}.jpg` : null} alt="Stack of {d.target}" />
		</Card></div>
		<div class="frames"><FrameList sessionId={d.id} frames={d.frames} pending={d.pending} onchanged={() => session.load(d.id)} /></div>
	</div>
	<div class="right">
		<SessionNumbers session={d} />
		<Timeline session={d} site={data.site} nowS={now.ms / 1000} />
		<Guiding guiding={d.guiding} frames={d.frames} wind={session.wind} windError={session.windError} />
		<Quality frames={d.frames} />
		<Telemetry telemetry={d.telemetry} />
	</div>
</main>

<style>
	.report {
		display: grid;
		gap: var(--gap);
		grid-template-columns: minmax(0, 1fr);
	}
	/* Phone: one column, the frames last. */
	.left,
	.right {
		display: contents;
	}
	.stack {
		order: 1;
	}
	.right > :global(*) {
		order: 2;
	}
	.frames {
		order: 3;
	}
	.title {
		order: 0;
	}
	.title {
		display: flex;
		align-items: baseline;
		flex-wrap: wrap;
		gap: 4px 14px;
	}
	.back {
		flex-basis: 100%;
		font-size: 13px;
		text-decoration: none;
		color: var(--muted);
	}
	h1 {
		margin: 0;
		font-size: 28px;
		letter-spacing: -0.02em;
	}
	@media (min-width: 1000px) {
		.report {
			grid-template-columns: minmax(0, 1.05fr) minmax(0, 1fr);
			align-items: start;
		}
		.title {
			grid-column: 1 / -1;
		}
		.left,
		.right {
			display: flex;
			flex-direction: column;
			gap: var(--gap);
			min-width: 0;
		}
	}
</style>
