<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import Card from './Card.svelte';
	import { clock, formatBytes, formatDuration } from '$lib/format';
	import type { Timelapse, TimelapseStep } from '$lib/types';

	/**
	 * B4: the session as a timelapse, built by the service on request: Frames (every analysed frame on the
	 * session's grid with one fixed stretch, rejected ones marked) or Stack (the stack growing frame by
	 * frame). Play/pause, speed, scrubber, arrow keys, the animated WebP for download. Asks for the
	 * timelapse only once the card is on screen (a first build takes the service about a minute) and
	 * again whenever `version` (the session's frames and decisions) changes.
	 */
	let { sessionId, version }: { sessionId: string; version: string } = $props();

	const SPEEDS = [2, 4, 8, 15];
	const BUSY_POLL_MS = 2000;
	const ERROR_POLL_MS = 30_000;
	const PRELOAD_PARALLEL = 4;

	let data = $state<Timelapse | null>(null);
	let loadError = $state<string | null>(null);
	let kind = $state<'frames' | 'stack'>('frames');
	let index = $state(0);
	let playing = $state(false);
	let fps = $state(8);
	let visible = $state(false);
	/** Step URLs already in the browser's cache. */
	let loaded = $state<Record<string, boolean>>({});
	let card: HTMLDivElement;

	const sequence = $derived(data?.[kind] ?? null);
	const steps = $derived(sequence?.steps ?? []);
	const current = $derived<TimelapseStep | null>(steps[Math.min(index, steps.length - 1)] ?? null);
	const loadedCount = $derived(steps.filter((s) => loaded[s.url]).length);
	const busy = $derived(data?.state === 'building' || data?.state === 'queued');
	const fraction = $derived(data?.progress && data.progress.total > 0 ? data.progress.done / data.progress.total : null);

	async function load() {
		try {
			const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/timelapse`);
			if (!response.ok) throw new Error((await response.json().catch(() => null))?.message ?? `HTTP ${response.status}`);
			data = (await response.json()) as Timelapse;
			loadError = null;
		} catch (e) {
			loadError = (e as Error).message;
		}
	}

	onMount(() => {
		const observer = new IntersectionObserver(
			(entries) => {
				if (entries.some((e) => e.isIntersecting)) {
					visible = true;
					observer.disconnect();
				}
			},
			{ rootMargin: '200px' }
		);
		observer.observe(card);
		return () => observer.disconnect();
	});

	// First look once on screen; again when the session's frames or decisions change.
	$effect(() => {
		if (!visible) return;
		void version;
		void sessionId;
		untrack(() => load());
	});

	// While building or queued: every 2 s; waiting (a running session rebuilds at most every few minutes) or failed: when the service says.
	$effect(() => {
		let delay: number | null = null;
		if (loadError) delay = ERROR_POLL_MS;
		else if (data?.state === 'building' || data?.state === 'queued') delay = BUSY_POLL_MS;
		else if ((data?.state === 'waiting' || data?.state === 'failed') && data.nextBuildAt) delay = Math.max(1000, data.nextBuildAt * 1000 - Date.now() + 1000);
		if (delay === null) return;
		const timer = setTimeout(load, delay);
		return () => clearTimeout(timer);
	});

	// Keep the position inside the sequence when it changes.
	$effect(() => {
		if (index > steps.length - 1) index = Math.max(0, steps.length - 1);
	});

	// Preload the pictures, a few at a time, from the current position on.
	$effect(() => {
		const urls = steps.map((s) => s.url);
		const start = untrack(() => Math.min(index, Math.max(0, urls.length - 1)));
		const order = [...urls.slice(start), ...urls.slice(0, start)].filter((u) => !untrack(() => loaded[u]));
		let cancelled = false;
		let next = 0;
		function one() {
			if (cancelled || next >= order.length) return;
			const url = order[next++];
			const img = new Image();
			img.onload = img.onerror = () => {
				loaded[url] = true;
				one();
			};
			img.src = url;
		}
		for (let i = 0; i < PRELOAD_PARALLEL; i++) one();
		return () => {
			cancelled = true;
		};
	});

	// Playing: the next step once its picture is loaded; round and round.
	$effect(() => {
		if (!playing || steps.length < 2) return;
		const list = steps;
		const timer = setInterval(() => {
			const next = (index + 1) % list.length;
			if (loaded[list[next].url]) index = next;
		}, 1000 / fps);
		return () => clearInterval(timer);
	});

	/** Switch sequences at the same moment of the night. */
	function choose(k: 'frames' | 'stack') {
		if (k === kind) return;
		const at = current?.at ?? 0;
		const target = data?.[k]?.steps ?? [];
		let i = 0;
		while (i + 1 < target.length && target[i + 1].at <= at) i++;
		kind = k;
		index = i;
	}

	function step(delta: number) {
		playing = false;
		index = Math.max(0, Math.min(steps.length - 1, index + delta));
	}

	function key(event: KeyboardEvent) {
		if (event.target instanceof HTMLSelectElement) return;
		if (event.key === 'ArrowLeft') step(-1);
		else if (event.key === 'ArrowRight') step(1);
		else if (event.key === 'Home') step(-steps.length);
		else if (event.key === 'End') step(steps.length);
		else if (event.key === ' ' && !(event.target instanceof HTMLButtonElement)) playing = !playing;
		else return;
		event.preventDefault();
	}

	const position = (i: number) => (steps.length > 1 ? i / (steps.length - 1) : 0);

	function progressLabel(t: Timelapse): string {
		if (t.state === 'queued') return 'Waiting for its turn';
		const p = t.progress;
		if (!p) return 'Building';
		if (p.kind === 'frames') return `Rendering frames ${p.done}/${p.total}`;
		if (p.kind === 'stack') return `Stacking ${p.done}/${p.total}`;
		return 'Writing the animations';
	}
</script>

<div class="wrap" bind:this={card}>
	<Card title="Timelapse">
		{#snippet accessory()}
			{#if data && busy && (data.frames || data.stack)}<span>Updating…</span>{:else if steps.length}<span class="num">{steps.length} {kind === 'frames' ? 'frames' : 'steps'}</span>{/if}
		{/snippet}
		{#if !data}
			<p class="muted small">{loadError ? `Unavailable: ${loadError}` : visible ? 'Loading…' : ''}</p>
		{:else}
			{#if busy}
				<div class="building">
					<span class="small muted">{progressLabel(data)}{data.frames ? '; what is built so far plays below' : ''}</span>
					<div class="progress"><span style:width="{(fraction ?? 0) * 100}%"></span></div>
				</div>
			{:else if data.state === 'failed'}
				<p class="small warn">Build failed: {data.error}{data.nextBuildAt ? `; tried again at ${clock(data.nextBuildAt * 1000)}` : ''}</p>
			{:else if data.state === 'waiting'}
				<p class="small muted">Newer frames are added at {clock((data.nextBuildAt ?? 0) * 1000)} (at most every few minutes while the session runs).</p>
			{:else if data.state === 'unavailable'}
				<p class="small muted">No aligned frames yet.</p>
			{/if}
			{#if data.frames || data.stack}
				<div class="player">
					<div class="controls">
						<div class="toggle">
							<button class="btn" class:on={kind === 'frames'} disabled={!data.frames} onclick={() => choose('frames')}>Frames</button>
							<button class="btn" class:on={kind === 'stack'} disabled={!data.stack} onclick={() => choose('stack')}>Stack</button>
						</div>
						<button class="btn play" onclick={() => (playing = !playing)} disabled={steps.length < 2} aria-label={playing ? 'Pause' : 'Play'}>
							{#if playing}
								<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h3v14H7zM14 5h3v14h-3z" fill="currentColor" /></svg>
							{:else}
								<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.5v15l12-7.5z" fill="currentColor" /></svg>
							{/if}
						</button>
						<select class="field speed" bind:value={fps} aria-label="Speed">
							{#each SPEEDS as s (s)}<option value={s}>{s}/s</option>{/each}
						</select>
						{#if sequence?.webpUrl}
							<a class="btn download" href={sequence.webpUrl} download>WebP · {formatBytes(sequence.webpBytes)}</a>
						{/if}
					</div>
					{#if current}
						<button class="picture" style:aspect-ratio="{data.width ?? 1} / {data.height ?? 1}" onclick={() => (playing = !playing)} onkeydown={key} disabled={steps.length < 2} aria-label="{playing ? 'Pause' : 'Play'} (arrow keys step)">
							<img src={current.url} alt="{data.target}, {kind === 'frames' ? `frame ${current.number}` : `stack of ${current.frames} frames`}" />
							{#if kind === 'frames' && !current.accepted}<span class="badge">Rejected</span>{/if}
							{#if loadedCount < steps.length}<span class="loading num">{loadedCount}/{steps.length}</span>{/if}
						</button>
						<div class="scrub">
							<input type="range" min="0" max={Math.max(0, steps.length - 1)} step="1" bind:value={index} oninput={() => (playing = false)} onkeydown={key} aria-label="Step" />
							{#if kind === 'frames'}
								<div class="marks" aria-hidden="true">
									{#each steps as s, i (s.url)}
										{#if !s.accepted}<span class="mark" style:left="calc(10px + (100% - 20px) * {position(i)})"></span>{/if}
									{/each}
								</div>
							{/if}
						</div>
						<div class="caption small">
							<span class="num">{clock(current.at * 1000)}</span>
							{#if kind === 'frames'}
								<span class="num">#{current.number} · {index + 1}/{steps.length}</span>
								{#if current.placement && current.placement !== 'aligned'}<span class="muted">not aligned: placed {current.placement === 'plateSolve' ? 'by its plate solve' : 'like its neighbour'}</span>{/if}
								{#if !current.accepted}<span class="reason">{current.rejectReason ?? 'not in the stack'}</span>{/if}
							{:else}
								<span class="num">{current.frames} frame{current.frames === 1 ? '' : 's'} · {formatDuration(current.integrationS)}</span>
								<span class="muted">running mean (the stack itself is sigma-clipped)</span>
							{/if}
						</div>
					{/if}
				</div>
			{/if}
		{/if}
	</Card>
</div>

<style>
	.wrap {
		min-width: 0;
	}
	.small {
		font-size: 13px;
	}
	p {
		margin: 0;
	}
	.building {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.player {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.controls {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px;
	}
	.toggle {
		display: flex;
		gap: 4px;
	}
	.play {
		padding: 6px 10px;
	}
	.play svg {
		width: 16px;
		height: 16px;
	}
	.speed {
		padding: 4px 8px;
		font-size: 13px;
	}
	.download {
		margin-left: auto;
	}
	.picture {
		position: relative;
		display: block;
		width: 100%;
		padding: 0;
		border: 1px solid var(--border);
		border-radius: 16px;
		overflow: hidden;
		background: var(--bg);
		cursor: pointer;
	}
	.picture:disabled {
		cursor: default;
	}
	.picture:focus-visible {
		outline: 1px solid var(--accent);
		outline-offset: 2px;
	}
	.picture img {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		object-fit: contain;
		display: block;
	}
	.badge,
	.loading {
		position: absolute;
		top: 10px;
		padding: 2px 9px;
		border-radius: 999px;
		font-size: 12px;
		font-weight: 700;
		background: var(--bg);
		border: 1px solid currentColor;
	}
	.badge {
		left: 10px;
		color: var(--bad);
	}
	.loading {
		right: 10px;
		color: var(--muted);
	}
	.scrub {
		position: relative;
		padding-bottom: 8px;
	}
	.scrub input {
		width: 100%;
		height: 4px;
		margin: 8px 0;
		appearance: none;
		-webkit-appearance: none;
		border-radius: 2px;
		background: var(--surface-strong);
	}
	.scrub input::-webkit-slider-thumb {
		-webkit-appearance: none;
		width: 20px;
		height: 20px;
		border-radius: 50%;
		background: var(--accent);
		border: 0;
	}
	.scrub input::-moz-range-thumb {
		width: 20px;
		height: 20px;
		border-radius: 50%;
		background: var(--accent);
		border: 0;
	}
	.marks {
		position: absolute;
		left: 0;
		right: 0;
		bottom: 0;
		height: 6px;
		pointer-events: none;
	}
	.mark {
		position: absolute;
		top: 0;
		width: 3px;
		height: 6px;
		margin-left: -1.5px;
		border-radius: 1px;
		background: var(--bad);
	}
	.caption {
		display: flex;
		flex-wrap: wrap;
		gap: 2px 12px;
	}
	.reason {
		color: var(--bad);
	}
</style>
