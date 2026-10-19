<script lang="ts">
	import { clock, dayOf, instantTime, zoneOffsetMs } from '$lib/dates';
	import type { CameraTimeline } from '$lib/types';

	/**
	 * A recorded camera's timeline over [start, end]: its motion (faint) and smart detections
	 * (coloured), what Protect no longer has (shaded), the playhead, and hour ticks. Drag to scrub
	 * (`onscrub` while dragging, `onseek` on release).
	 */
	let {
		start,
		end,
		now,
		playhead,
		timeline,
		onscrub,
		onseek
	}: {
		start: number;
		end: number;
		now: number;
		playhead: number;
		timeline: CameraTimeline | null;
		onscrub: (ts: number) => void;
		onseek: (ts: number) => void;
	} = $props();

	let track: HTMLDivElement;
	/** The time under the finger while dragging. */
	let dragging = $state<number | null>(null);

	const span = $derived(end - start);
	const pct = (ms: number) => ((ms - start) / span) * 100;
	const earliest = $derived(Math.max(start, timeline?.recordingStart ?? start));
	const latest = $derived(Math.min(end, now));

	/** Smart detection colour; plain motion has none. */
	const COLORS: Record<string, string> = { person: '#fbbf24', vehicle: '#60a5fa', animal: '#4ade80' };
	const markers = $derived(
		(timeline?.events ?? [])
			.filter((e) => e.end >= start && e.start <= end)
			.map((e) => ({
				left: pct(Math.max(e.start, start)),
				width: Math.max(0.15, pct(Math.min(e.end, end)) - pct(Math.max(e.start, start))),
				color: e.types.length ? (COLORS[e.types[0]] ?? '#c084fc') : null
			}))
			// Smart detections drawn last, over plain motion.
			.sort((a, b) => Number(a.color !== null) - Number(b.color !== null))
	);

	/** Tick every 10 min over an hour, every hour over 6 h, every 3 h over a day; on Finnish wall-clock boundaries. */
	const ticks = $derived.by(() => {
		const step = span <= 3_600_000 ? 600_000 : span <= 6 * 3_600_000 ? 3_600_000 : 3 * 3_600_000;
		const offset = zoneOffsetMs(start);
		const out: { left: number; label: string }[] = [];
		for (let t = Math.ceil((start + offset) / step) * step - offset; t <= end; t += step) {
			const midnight = (t + offset) % 86_400_000 === 0;
			out.push({ left: pct(t), label: midnight ? dayOf(new Date(t).toISOString()) : clock(t) });
		}
		return out;
	});

	function timeAt(clientX: number): number {
		const box = track.getBoundingClientRect();
		const ts = start + ((clientX - box.left) / box.width) * span;
		return Math.round(Math.min(latest, Math.max(earliest, ts)));
	}

	function down(event: PointerEvent) {
		track.setPointerCapture(event.pointerId);
		dragging = timeAt(event.clientX);
		onscrub(dragging);
	}
	function move(event: PointerEvent) {
		if (dragging === null) return;
		dragging = timeAt(event.clientX);
		onscrub(dragging);
	}
	function up(event: PointerEvent) {
		if (dragging === null) return;
		const ts = timeAt(event.clientX);
		dragging = null;
		onseek(ts);
	}
</script>

<div class="timeline">
	<div
		class="track"
		bind:this={track}
		onpointerdown={down}
		onpointermove={move}
		onpointerup={up}
		onpointercancel={() => (dragging = null)}
		role="slider"
		tabindex="-1"
		aria-label="Recording timeline"
		aria-valuemin={earliest}
		aria-valuemax={latest}
		aria-valuenow={dragging ?? playhead}
		aria-valuetext={instantTime(dragging ?? playhead, now)}
	>
		{#if earliest > start}<div class="gone" style:width="{pct(earliest)}%"></div>{/if}
		{#if latest < end}<div class="future" style:left="{pct(latest)}%"></div>{/if}
		{#each markers as m, i (i)}
			<div class="event" class:smart={m.color !== null} style:left="{m.left}%" style:width="{m.width}%" style:background={m.color}></div>
		{/each}
		<div class="playhead" class:flip={pct(dragging ?? playhead) > 75} style:left="{pct(dragging ?? playhead)}%">
			{#if dragging !== null}<span>{instantTime(dragging, now)}</span>{/if}
		</div>
	</div>
	<div class="ticks">
		{#each ticks as t (t.left)}
			<span style:left="{t.left}%">{t.label}</span>
		{/each}
	</div>
</div>

<style>
	.timeline {
		display: grid;
		gap: 4px;
		user-select: none;
		-webkit-user-select: none;
	}
	.track {
		position: relative;
		height: 44px;
		border: 1px solid var(--border);
		border-radius: 12px;
		background: #0b0f19;
		overflow: hidden;
		touch-action: none;
		cursor: pointer;
	}
	.gone,
	.future {
		position: absolute;
		top: 0;
		bottom: 0;
		background: repeating-linear-gradient(135deg, rgba(255, 255, 255, 0.05) 0 6px, transparent 6px 12px);
	}
	.gone {
		left: 0;
	}
	.future {
		right: 0;
	}
	.event {
		position: absolute;
		top: 14px;
		bottom: 14px;
		min-width: 2px;
		border-radius: 2px;
		background: rgba(255, 255, 255, 0.28);
	}
	.event.smart {
		top: 8px;
		bottom: 8px;
	}
	.playhead {
		position: absolute;
		top: 0;
		bottom: 0;
		width: 2px;
		margin-left: -1px;
		background: #ef4444;
		box-shadow: 0 0 8px rgba(239, 68, 68, 0.8);
		pointer-events: none;
	}
	.playhead.flip span {
		left: auto;
		right: 6px;
	}
	.playhead span {
		position: absolute;
		top: 4px;
		left: 6px;
		padding: 2px 7px;
		font-size: 12px;
		font-weight: 600;
		white-space: nowrap;
		border-radius: 6px;
		background: rgba(0, 0, 0, 0.75);
	}
	.ticks {
		position: relative;
		height: 16px;
		font-size: 11px;
		color: var(--muted);
	}
	.ticks span {
		position: absolute;
		transform: translateX(-50%);
		white-space: nowrap;
	}
</style>
