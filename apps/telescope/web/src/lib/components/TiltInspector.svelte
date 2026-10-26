<script lang="ts">
	import TiltGrid from './TiltGrid.svelte';
	import TiltNumbers from './TiltNumbers.svelte';
	import { clock } from '$lib/format';
	import { portal } from '$lib/portal';
	import type { FrameInspection } from '$lib/types';

	/**
	 * A6: one frame's tilt and backfocus inspection, full screen: the verdict, the 3×3 grid (FWHM heat map with
	 * the numbers and elongation ticks), the summary numbers and the aberration inspector: 1:1 crops of the
	 * sensor's corners, edge middles and centre in the frame's screen stretch (tap for 1:1). Measured by the
	 * service from the archived FITS on first request (about a second).
	 */
	let { sessionId, frameId, number, onclose }: { sessionId: string; frameId: string; number: number | null; onclose: () => void } = $props();

	let data = $state<FrameInspection | null>(null);
	let failure = $state<string | null>(null);
	let zoomed = $state(false);

	$effect(() => {
		const url = `/api/sessions/${encodeURIComponent(sessionId)}/frames/${encodeURIComponent(frameId)}/inspect`;
		const abort = new AbortController();
		data = null;
		failure = null;
		fetch(url, { signal: abort.signal })
			.then(async (r) => {
				if (!r.ok) throw new Error((await r.json().catch(() => null))?.message ?? `HTTP ${r.status}`);
				data = (await r.json()) as FrameInspection;
			})
			.catch((e: Error) => {
				if (!abort.signal.aborted) failure = e.message;
			});
		return () => abort.abort();
	});

	$effect(() => {
		const key = (e: KeyboardEvent) => {
			if (e.key === 'Escape') {
				e.stopImmediatePropagation();
				onclose();
			}
		};
		addEventListener('keydown', key, { capture: true });
		return () => removeEventListener('keydown', key, { capture: true });
	});
</script>

<div class="inspector" use:portal role="dialog" aria-modal="true" aria-label="Tilt and backfocus, frame {number ?? ''}">
	<header>
		<h2>Tilt and backfocus · frame #{number ?? '–'}{data ? ` · ${clock(data.at * 1000)}` : ''}</h2>
		<button onclick={onclose} aria-label="Close">✕</button>
	</header>
	{#if failure}
		<p class="warn">Inspection unavailable: {failure}</p>
	{:else if !data}
		<p class="muted">Measuring the frame from the archive…</p>
	{:else}
		<div class="body">
			<section class="left">
				<p class="verdict" data-level={data.summary.level}>{data.summary.verdict}</p>
				<TiltGrid cells={data.cells} width={data.width} height={data.height} detail />
				<TiltNumbers summary={data.summary} />
				<p class="note muted">
					FWHM in camera pixels{data.pixelScaleArcsec ? ` (${data.pixelScaleArcsec.toFixed(2)}″ each)` : ''}, Gaussian-equivalent from adaptive moments on
					the full-resolution green: smaller than the frame list's FWHM, whose plain moments noise inflates. Ticks: the stars' long axis, longer when
					more elongated. One frame carries its seeing; the session's card takes the median of its best frames.
				</p>
			</section>
			<section class="right">
				<button class="mosaic" class:zoomed onclick={() => (zoomed = !zoomed)} aria-label={zoomed ? 'Fit' : 'One image pixel per screen pixel'}>
					<img src={data.mosaicUrl} alt="Corners, edges and centre of frame {number ?? ''} at 1:1" width={3 * data.cropPx + 2 * data.gapPx} height={3 * data.cropPx + 2 * data.gapPx} />
				</button>
				<p class="note muted">Crops of {data.cropPx} camera pixels from the sensor's corners, the middles of its edges and its centre, debayered, in the frame's screen stretch. Tap to see them at one image pixel per screen pixel.</p>
			</section>
		</div>
	{/if}
</div>

<style>
	.inspector {
		position: fixed;
		inset: 0;
		z-index: 60;
		overflow: auto;
		background: var(--bg);
		padding: calc(env(safe-area-inset-top) + 12px) calc(env(safe-area-inset-right) + 14px) calc(env(safe-area-inset-bottom) + 14px)
			calc(env(safe-area-inset-left) + 14px);
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
	}
	h2 {
		margin: 0;
		font-size: 15px;
		font-weight: 650;
	}
	header button {
		padding: 6px 13px;
		border-radius: 999px;
		border: 1px solid var(--border);
		background: var(--surface);
		color: var(--muted);
		font-size: 15px;
		cursor: pointer;
	}
	p {
		margin: 0;
	}
	.body {
		display: grid;
		gap: 16px;
		grid-template-columns: minmax(0, 1fr);
		align-items: start;
	}
	.left,
	.right {
		display: flex;
		flex-direction: column;
		gap: 10px;
		min-width: 0;
	}
	.verdict {
		font-size: 14px;
		line-height: 1.4;
	}
	.verdict[data-level='ok'] {
		color: var(--ok);
	}
	.verdict[data-level='minor'] {
		color: var(--warn);
	}
	.verdict[data-level='check'] {
		color: var(--bad);
	}
	.note {
		font-size: 12px;
		line-height: 1.4;
	}
	.mosaic {
		padding: 0;
		border: 1px solid var(--border);
		border-radius: 12px;
		overflow: auto;
		background: var(--bg);
		cursor: zoom-in;
		max-width: 100%;
	}
	.mosaic img {
		display: block;
		width: 100%;
		height: auto;
	}
	.mosaic.zoomed {
		cursor: zoom-out;
	}
	.mosaic.zoomed img {
		width: auto;
		max-width: none;
		image-rendering: pixelated;
	}
	@media (min-width: 1000px) {
		.body {
			grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.1fr);
		}
	}
</style>
