<script lang="ts">
	import Card from './Card.svelte';
	import TiltGrid from './TiltGrid.svelte';
	import TiltInspector from './TiltInspector.svelte';
	import TiltNumbers from './TiltNumbers.svelte';
	import type { SessionInspection } from '$lib/types';

	/**
	 * A6 on the session report: tilt and backfocus from the median of the session's best accepted frames (the
	 * service picks them by stars / HFR and measures each from the archive once): the verdict, the 3×3 FWHM
	 * grid with elongation ticks, the numbers, and the frames used, each opening the full inspector. Asked again
	 * when the number of accepted frames changes (the best ones may change).
	 */
	let { sessionId, accepted }: { sessionId: string; accepted: number } = $props();

	let data = $state<SessionInspection | null>(null);
	let failure = $state<string | null>(null);
	let open = $state<{ id: string; number: number | null } | null>(null);

	$effect(() => {
		const url = `/api/sessions/${encodeURIComponent(sessionId)}/inspect`;
		void accepted;
		const abort = new AbortController();
		failure = null;
		fetch(url, { signal: abort.signal })
			.then(async (r) => {
				if (!r.ok) throw new Error((await r.json().catch(() => null))?.message ?? `HTTP ${r.status}`);
				data = (await r.json()) as SessionInspection;
			})
			.catch((e: Error) => {
				if (!abort.signal.aborted) failure = e.message;
			});
		return () => abort.abort();
	});
</script>

<Card title="Tilt and backfocus">
	{#snippet accessory()}
		{#if data?.frames.length}<span class="num">median of {data.frames.length} best frame{data.frames.length === 1 ? '' : 's'}</span>{/if}
	{/snippet}
	{#if failure && !data}
		<p class="warn small">Unavailable: {failure}</p>
	{:else if !data}
		<p class="muted small">Measuring the best frames from the archive…</p>
	{:else if !data.cells || !data.summary}
		<p class="muted small">No accepted frames in the archive yet.</p>
	{:else}
		<p class="verdict small" data-level={data.summary.level}>{data.summary.verdict}</p>
		<div class="grid"><TiltGrid cells={data.cells} width={data.width} height={data.height} /></div>
		<TiltNumbers summary={data.summary} />
		<div class="frames small">
			<span class="muted">FWHM in camera px. Frames:</span>
			{#each data.frames as f (f.id)}
				<button onclick={() => (open = f)} title="Inspect frame {f.number ?? ''}">#{f.number ?? '–'}</button>
			{/each}
		</div>
	{/if}
</Card>

{#if open}
	<TiltInspector {sessionId} frameId={open.id} number={open.number} onclose={() => (open = null)} />
{/if}

<style>
	p {
		margin: 0;
	}
	.small {
		font-size: 13px;
	}
	.verdict {
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
	.grid {
		max-width: 320px;
	}
	.frames {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 6px;
	}
	.frames button {
		padding: 3px 9px;
		border-radius: 999px;
		border: 1px solid var(--border);
		background: var(--surface);
		color: var(--text);
		font-size: 12px;
		font-weight: 600;
		cursor: pointer;
	}
</style>
