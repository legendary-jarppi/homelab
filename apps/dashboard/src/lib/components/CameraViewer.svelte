<script lang="ts">
	import { onMount } from 'svelte';
	import { fade, scale } from 'svelte/transition';
	import RecordingPlayer from './RecordingPlayer.svelte';
	import Timeline from './Timeline.svelte';
	import { instantTime } from '$lib/dates';
	import { PIECE_MS } from '$lib/recording';
	import type { CameraTimeline, LiveCamera } from '$lib/types';

	type LiveCamElement = HTMLElement & { src: string; video?: HTMLVideoElement; ondisconnect?: () => void };

	/**
	 * Full-screen camera: live video (go2rtc), and for cameras recorded by Protect a timeline to go
	 * back in time: drag for stills, release to play the recording from there (RecordingPlayer), back
	 * to live with *Live* or when playback catches up with the present.
	 */
	let {
		cameras,
		index = $bindable(),
		onclose
	}: { cameras: LiveCamera[]; index: number; onclose: () => void } = $props();

	const HOUR = 3_600_000;
	const SPANS = [
		{ ms: HOUR, label: '1 h' },
		{ ms: 6 * HOUR, label: '6 h' },
		{ ms: 24 * HOUR, label: '24 h' }
	];
	const RATES = [1, 2, 4];
	const SKIP_MS = 10_000;
	/** Closer to now than this, there is no finished recording yet: live video instead. */
	const LIVE_EDGE_MS = PIECE_MS + 5_000;

	let host = $state<HTMLDivElement>();
	let ready = $state(false);
	let playing = $state(false);

	const camera = $derived(cameras[index]);
	let mode = $state<'live' | 'recording'>('live');
	/** Playback position (recording mode), unix ms. */
	let time = $state(0);
	let seek = $state({ at: 0 });
	let paused = $state(false);
	let rate = $state(1);
	let waiting = $state(false);
	let failure = $state<string | null>(null);

	let now = $state(Date.now());
	let span = $state(HOUR);
	/** The timeline window ends now (`follow`) or at `windowEnd`. */
	let follow = $state(true);
	let windowEnd = $state(Date.now());
	const end = $derived(follow ? now : windowEnd);
	const start = $derived(end - span);
	let timeline = $state<CameraTimeline | null>(null);

	/** Still shown while scrubbing, and until the recording plays. */
	let preview = $state<{ ts: number; url: string } | null>(null);
	let scrubTarget: number | null = null;
	let stillLoading = false;

	onMount(() => {
		import('$lib/live-cam').then(() => (ready = true));
		const tick = setInterval(() => (now = Date.now()), 1000);
		return () => {
			clearInterval(tick);
			if (preview) URL.revokeObjectURL(preview.url);
		};
	});

	// Live video only in live mode: one stream at a time, torn down while recordings play (the cabin's
	// mobile link carries either, not both).
	$effect(() => {
		if (!ready || mode !== 'live' || !host) return;
		playing = false;
		const el = document.createElement('live-cam') as LiveCamElement;
		host.appendChild(el);
		el.video?.addEventListener('playing', () => (playing = true));
		el.src = `/cameras/live?src=${encodeURIComponent(camera.id)}`;
		return () => {
			el.ondisconnect?.();
			el.remove();
		};
	});

	// The window's events, refetched when it moves (in live mode every 30 s).
	const fetchEnd = $derived(Math.ceil(end / 30_000) * 30_000);
	$effect(() => {
		if (!camera.recorded) return;
		const url = `/api/cameras/${encodeURIComponent(camera.id)}/timeline?start=${fetchEnd - span}&end=${fetchEnd}`;
		const controller = new AbortController();
		const timer = setTimeout(async () => {
			try {
				const res = await fetch(url, { signal: controller.signal });
				if (res.ok) timeline = (await res.json()) as CameraTimeline;
			} catch {
				// Keeps the previous markers.
			}
		}, 250);
		return () => {
			clearTimeout(timer);
			controller.abort();
		};
	});

	function goLive() {
		mode = 'live';
		follow = true;
		paused = false;
		failure = null;
		waiting = false;
		clearPreview();
	}

	/** Fixes the window so it shows `ts`. */
	function reveal(ts: number) {
		if (follow) windowEnd = Date.now();
		follow = false;
		if (ts < windowEnd - span || ts > windowEnd) windowEnd = Math.min(Date.now(), ts + span / 2);
	}

	function playFrom(ts: number) {
		if (ts > Date.now() - LIVE_EDGE_MS) return goLive();
		ts = Math.max(ts, timeline?.recordingStart ?? 0);
		mode = 'recording';
		failure = null;
		time = ts;
		seek = { at: ts };
		reveal(ts);
	}

	function clearPreview() {
		if (preview) URL.revokeObjectURL(preview.url);
		preview = null;
		scrubTarget = null;
	}

	/** Shows the still nearest the finger; one request at a time, always for the latest position. */
	async function scrub(ts: number) {
		scrubTarget = Math.round(ts / 1000) * 1000;
		if (stillLoading) return;
		stillLoading = true;
		try {
			while (scrubTarget !== null && scrubTarget !== preview?.ts) {
				const target = scrubTarget;
				const res = await fetch(`/cameras/${encodeURIComponent(camera.id)}/still?ts=${target}`);
				if (!res.ok || scrubTarget === null) break;
				const url = URL.createObjectURL(await res.blob());
				if (preview) URL.revokeObjectURL(preview.url);
				preview = { ts: target, url };
			}
		} finally {
			stillLoading = false;
		}
	}

	function release(ts: number) {
		playFrom(ts);
		if (mode === 'live') clearPreview();
	}

	function setSpan(ms: number) {
		span = ms;
		if (mode === 'recording') {
			follow = false;
			windowEnd = Math.min(Date.now(), time + ms / 2);
		}
	}

	/** Moves the window by half its length (not before the oldest recording); back at now it follows now again. */
	function shift(direction: -1 | 1) {
		const from = follow ? Date.now() : windowEnd;
		const target = Math.max((timeline?.recordingStart ?? 0) + span, from + (direction * span) / 2);
		follow = target >= Date.now();
		windowEnd = Math.min(Date.now(), target);
	}

	function step(delta: number) {
		index = (index + delta + cameras.length) % cameras.length;
		// The same moment on the next camera, as Protect does.
		if (mode === 'recording') {
			if (cameras[index].recorded) seek = { at: time };
			else goLive();
		}
	}

	function skip(delta: number) {
		playFrom((mode === 'live' ? Date.now() - LIVE_EDGE_MS : time) + delta);
	}

	function onkeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') onclose();
		else if (event.key === 'ArrowRight') step(1);
		else if (event.key === 'ArrowLeft') step(-1);
		else if (event.key === ' ' && mode === 'recording') {
			event.preventDefault();
			paused = !paused;
		}
	}

	// Playback leaving the window drags it along.
	$effect(() => {
		if (mode === 'recording' && !follow && time > windowEnd) windowEnd = Math.min(Date.now(), time + span / 2);
	});
</script>

<svelte:window {onkeydown} />

<div class="backdrop" transition:fade={{ duration: 180 }} onclick={(e) => e.target === e.currentTarget && onclose()} role="presentation">
	<div
		class="viewer"
		class:recorded={camera.recorded}
		transition:scale={{ start: 0.96, duration: 220 }}
		role="dialog"
		aria-modal="true"
		aria-label="{camera.label} video"
		tabindex="-1"
	>
		<div class="video" bind:this={host}>
			{#if mode === 'recording'}
				{#key camera.id}
					<RecordingPlayer
						camera={camera.id}
						{seek}
						{paused}
						{rate}
						ontime={(ms) => {
							time = ms;
							if (!waiting && preview && !stillLoading) clearPreview();
						}}
						onwaiting={(w) => {
							waiting = w;
							if (w) failure = null;
							else if (!stillLoading) clearPreview();
						}}
						onerror={(message) => {
							waiting = false;
							failure = message;
						}}
						oncaughtup={goLive}
					/>
				{/key}
			{/if}
			{#if preview}<img class="preview" src={preview.url} alt="" />{/if}
			{#if failure}
				<div class="status">{failure}</div>
			{:else if mode === 'live' ? !playing && !preview : waiting}
				<div class="status">{mode === 'live' ? 'Connecting…' : 'Loading recording…'}</div>
			{/if}
		</div>

		{#if camera.recorded}
			<Timeline {start} {end} {now} playhead={mode === 'live' ? now : time} {timeline} onscrub={scrub} onseek={release} />
		{/if}

		<div class="bar">
			{#if mode === 'live'}
				<span class="badge"><i></i>Live</span>
			{:else}
				<button class="pill" onclick={goLive}>Live</button>
			{/if}
			<span class="title">
				{camera.label}
				{#if mode === 'recording'}<span class="when">{instantTime(time, now)}</span>{/if}
			</span>
			{#if camera.recorded}
				<div class="actions">
					<button onclick={() => skip(-SKIP_MS)} aria-label="Back 10 seconds">
						<svg viewBox="0 0 24 24"><path d="M11 7 6 12l5 5M18 7l-5 5 5 5" /></svg>
					</button>
					{#if mode === 'recording'}
						<button onclick={() => (paused = !paused)} aria-label={paused ? 'Play' : 'Pause'}>
							{#if paused}
								<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
							{:else}
								<svg viewBox="0 0 24 24"><path d="M9 5v14M15 5v14" /></svg>
							{/if}
						</button>
						<button onclick={() => skip(SKIP_MS)} aria-label="Forward 10 seconds">
							<svg viewBox="0 0 24 24"><path d="m13 7 5 5-5 5M6 7l5 5-5 5" /></svg>
						</button>
						<button class="rate" onclick={() => (rate = RATES[(RATES.indexOf(rate) + 1) % RATES.length])} aria-label="Playback speed">{rate}×</button>
					{/if}
				</div>
				<div class="spans" role="radiogroup" aria-label="Timeline length">
					<button onclick={() => shift(-1)} aria-label="Earlier">
						<svg viewBox="0 0 24 24"><path d="m15 5-7 7 7 7" /></svg>
					</button>
					{#each SPANS as s (s.ms)}
						<button role="radio" aria-checked={span === s.ms} class:active={span === s.ms} onclick={() => setSpan(s.ms)}>{s.label}</button>
					{/each}
					<button onclick={() => shift(1)} disabled={follow} aria-label="Later">
						<svg viewBox="0 0 24 24"><path d="m9 5 7 7-7 7" /></svg>
					</button>
				</div>
			{/if}
			<div class="actions">
				{#if cameras.length > 1}
					<button onclick={() => step(-1)} aria-label="Previous camera">
						<svg viewBox="0 0 24 24"><path d="m15 5-7 7 7 7" /></svg>
					</button>
					<button onclick={() => step(1)} aria-label="Next camera">
						<svg viewBox="0 0 24 24"><path d="m9 5 7 7-7 7" /></svg>
					</button>
				{/if}
				<button onclick={onclose} aria-label="Close">
					<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18" /></svg>
				</button>
			</div>
		</div>
	</div>
</div>

<style>
	.backdrop {
		position: fixed;
		inset: 0;
		z-index: 50;
		display: grid;
		place-items: center;
		padding: max(16px, env(safe-area-inset-top)) max(16px, env(safe-area-inset-right))
			max(16px, env(safe-area-inset-bottom)) max(16px, env(safe-area-inset-left));
		background: rgba(3, 5, 10, 0.78);
		backdrop-filter: blur(18px);
		-webkit-backdrop-filter: blur(18px);
	}
	.viewer {
		width: min(100%, calc((100dvh - 120px) * 16 / 9), 1600px);
		display: grid;
		gap: 12px;
		outline: none;
	}
	/* Room for the timeline under the video. */
	.viewer.recorded {
		width: min(100%, calc((100dvh - 200px) * 16 / 9), 1600px);
	}
	.video {
		position: relative;
		aspect-ratio: 16 / 9;
		border-radius: 20px;
		overflow: hidden;
		background: #000;
		box-shadow: 0 40px 100px rgba(0, 0, 0, 0.6);
	}
	.video :global(live-cam) {
		display: block;
		width: 100%;
		height: 100%;
	}
	.preview {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		object-fit: contain;
		background: #000;
	}
	.status {
		position: absolute;
		inset: 0;
		display: grid;
		place-items: center;
		color: var(--muted);
		font-size: 15px;
		pointer-events: none;
		text-shadow: 0 1px 6px rgba(0, 0, 0, 0.8);
	}
	.bar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 12px;
	}
	.title {
		flex: 1;
		min-width: 0;
		font-size: 20px;
		font-weight: 600;
		white-space: nowrap;
	}
	.when {
		margin-left: 10px;
		font-size: 15px;
		font-weight: 500;
		color: var(--muted);
		font-variant-numeric: tabular-nums;
	}
	.badge,
	.pill {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 4px 10px;
		font-size: 12px;
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		border-radius: 999px;
	}
	.badge {
		background: rgba(239, 68, 68, 0.15);
		color: #fca5a5;
	}
	.badge i {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: #ef4444;
		box-shadow: 0 0 8px #ef4444;
	}
	.pill {
		height: 32px;
		padding: 0 14px;
		border: 1px solid var(--border);
		background: var(--surface-strong);
		color: var(--text);
		cursor: pointer;
	}
	.actions,
	.spans {
		display: flex;
		gap: 8px;
	}
	.actions button,
	.spans button {
		width: 44px;
		height: 44px;
		display: grid;
		place-items: center;
		border: 1px solid var(--border);
		border-radius: 50%;
		background: var(--surface-strong);
		color: var(--text);
		cursor: pointer;
	}
	.spans button[role='radio'] {
		width: auto;
		padding: 0 12px;
		border-radius: 999px;
		font-size: 13px;
		font-weight: 600;
		color: var(--muted);
	}
	.spans button.active {
		color: var(--text);
		border-color: rgba(251, 191, 36, 0.5);
		background: rgba(251, 191, 36, 0.15);
	}
	.spans button:disabled {
		opacity: 0.35;
		cursor: default;
	}
	.actions .rate {
		font-size: 13px;
		font-weight: 700;
	}
	svg {
		width: 20px;
		height: 20px;
		fill: none;
		stroke: currentColor;
		stroke-width: 2;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
</style>
