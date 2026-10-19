<script lang="ts">
	import ImageViewer from './ImageViewer.svelte';
	import { formatAgo, formatDuration, nightLabel } from '$lib/format';
	import type { Final } from '$lib/types';

	/** D3: one final stack: its preview (full screen on tap), status and progress, nights, calibration with warnings, downloads, the log. */
	let { final: f, nowMs }: { final: Final; nowMs: number } = $props();

	let viewing = $state(false);
	let log = $state<string[] | null>(null);
	let logError = $state<string | null>(null);

	const STATUS: Record<Final['status'], { label: string; tone: string }> = {
		queued: { label: 'Queued', tone: '' },
		running: { label: 'Running', tone: 'accent' },
		done: { label: 'Done', tone: 'ok' },
		failed: { label: 'Failed', tone: 'bad' }
	};
	/** "registering 34/80" -> 0.425. */
	const fraction = $derived.by(() => {
		const m = /(\d+)\s*\/\s*(\d+)/.exec(f.progress ?? '');
		return m && Number(m[2]) > 0 ? Math.min(1, Number(m[1]) / Number(m[2])) : null;
	});
	const calibration = $derived(
		(
			[
				['Bias', f.calibration.bias],
				['Dark', f.calibration.dark],
				['Flat', f.calibration.flat],
				['Dark flat', f.calibration.darkFlat]
			] as const
		).filter(([, id]) => id !== null)
	);
	const took = $derived(f.startedAt !== null ? ((f.finishedAt ?? nowMs / 1000) - f.startedAt) : null);

	async function loadLog() {
		try {
			const response = await fetch(`/api/finals/${encodeURIComponent(f.id)}`);
			if (!response.ok) throw new Error(`HTTP ${response.status}`);
			log = ((await response.json()) as Final).log ?? [];
			logError = null;
		} catch (e) {
			logError = (e as Error).message;
		}
	}
</script>

<article class="final" id="final-{f.id}">
	<div class="thumb">
		{#if f.outputs.previewSmallJpg || f.outputs.previewJpg}
			<button onclick={() => (viewing = true)} aria-label="Open {f.target} full screen"><img src={f.outputs.previewSmallJpg ?? f.outputs.previewJpg} alt="Final stack of {f.target}" loading="lazy" /></button>
		{:else}
			<span class="none faint">
				{#if f.status === 'failed'}<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round" /></svg>{:else}…{/if}
			</span>
		{/if}
	</div>
	<div class="body">
		<div class="top">
			<strong>{f.target}</strong>
			<span class="tag {STATUS[f.status].tone}">{STATUS[f.status].label}</span>
			{#if f.automatic}<span class="tag" title="Started by the processor after the session">auto</span>{/if}
		</div>
		<span class="muted small">
			{f.nights.length === 1 ? nightLabel(f.nights[0]) : `${f.nights.length} nights, ${nightLabel(f.nights[0], false)} – ${nightLabel(f.nights.at(-1)!, true)}`}
			· <span class="num">{f.frames} frames · {formatDuration(f.integrationS)}</span>
		</span>
		{#if f.status === 'running'}
			<div class="running">
				<div class="progress" role="progressbar" aria-label="Progress" aria-valuemin="0" aria-valuemax="1" aria-valuenow={fraction ?? undefined}><span class:indeterminate={fraction === null} style:width="{(fraction ?? 0.3) * 100}%"></span></div>
				<span class="small num">{f.progress ?? 'starting'}{took !== null ? ` · ${formatDuration(took)}` : ''}</span>
			</div>
		{:else if f.status === 'queued'}
			<span class="small muted">Waiting, queued {formatAgo(f.createdAt, nowMs)}</span>
		{:else if f.status === 'failed'}
			<span class="small bad">{f.error ?? 'Failed'}</span>
		{:else}
			<span class="small muted num">Finished {f.finishedAt ? formatAgo(f.finishedAt, nowMs) : ''}{took !== null ? ` · took ${formatDuration(took)}` : ''}</span>
		{/if}
		{#if calibration.length || f.calibration.warnings.length}
			<span class="small">
				<span class="muted">Calibration:</span>
				{#if calibration.length}{calibration.map(([kind, id]) => `${kind} ${id}`).join(' · ')}{:else}<span class="warn">none</span>{/if}
			</span>
			{#if f.calibration.warnings.length}
				<ul class="warnings">
					{#each f.calibration.warnings as w (w)}<li class="warn">{w}</li>{/each}
				</ul>
			{/if}
		{/if}
		<div class="links">
			{#if f.outputs.linearFits}<a class="btn" href={f.outputs.linearFits} download>Linear FITS</a>{/if}
			{#if f.outputs.processedTiff}<a class="btn" href={f.outputs.processedTiff} download>TIFF</a>{/if}
			{#if f.outputs.previewJpg}<a class="btn" href={f.outputs.previewJpg} download>JPEG</a>{/if}
			<details ontoggle={(e) => e.currentTarget.open && loadLog()}>
				<summary class="btn">Log</summary>
				{#if logError}<p class="small bad">Log unavailable: {logError}</p>
				{:else if log === null}<p class="small muted">Loading…</p>
				{:else if log.length === 0}<p class="small muted">Empty.</p>
				{:else}<pre>{log.join('\n')}</pre>{/if}
			</details>
		</div>
	</div>
</article>

{#if viewing && f.outputs.previewJpg}
	<ImageViewer src={f.outputs.previewJpg} alt="Final stack of {f.target}" caption="{f.target} · {f.frames} frames · {formatDuration(f.integrationS)}" onclose={() => (viewing = false)} />
{/if}

<style>
	.final {
		display: flex;
		gap: 12px;
		align-items: flex-start;
		min-width: 0;
	}
	.thumb {
		flex: none;
		width: 96px;
		height: 96px;
		border-radius: 12px;
		overflow: hidden;
		background: #000;
		border: 1px solid var(--border);
	}
	.thumb button {
		display: block;
		width: 100%;
		height: 100%;
		padding: 0;
		border: 0;
		background: none;
		cursor: zoom-in;
	}
	.thumb img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
	}
	.none {
		display: grid;
		place-items: center;
		height: 100%;
		font-size: 22px;
	}
	.none svg {
		width: 26px;
		height: 26px;
	}
	.body {
		display: flex;
		flex-direction: column;
		gap: 4px;
		min-width: 0;
		flex: 1;
	}
	.top {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 6px 8px;
		font-size: 16px;
	}
	.small {
		font-size: 13px;
	}
	.bad {
		color: var(--bad);
	}
	.running {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.indeterminate {
		animation: slide 1.6s ease-in-out infinite;
	}
	@keyframes slide {
		from {
			left: -30%;
		}
		to {
			left: 100%;
		}
	}
	.warnings {
		margin: 0;
		padding-left: 18px;
		font-size: 13px;
	}
	.links {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		margin-top: 4px;
		align-items: flex-start;
	}
	details[open] {
		flex-basis: 100%;
	}
	summary {
		list-style: none;
		display: inline-flex;
	}
	summary::-webkit-details-marker {
		display: none;
	}
	pre {
		margin: 6px 0 0;
		padding: 8px 10px;
		max-height: 220px;
		overflow: auto;
		font-size: 11px;
		line-height: 1.45;
		border-radius: 10px;
		background: rgba(0, 0, 0, 0.35);
		border: 1px solid var(--border);
		color: var(--muted);
		white-space: pre-wrap;
		word-break: break-all;
	}
</style>
