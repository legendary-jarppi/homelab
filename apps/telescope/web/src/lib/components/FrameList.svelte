<script lang="ts">
	import Card from './Card.svelte';
	import { arcsec, clock, fixed } from '$lib/format';
	import { portal } from '$lib/portal';
	import type { Frame } from '$lib/types';

	/**
	 * Every frame of a session (newest first): thumbnail, stats, accepted or rejected with the reason (A2), and
	 * Reject (or Accept) and, after an override, Auto buttons for the manual override (POST through this app's server route; the service
	 * restacks in the background). A thumbnail opens the frame large, with ← → to step through.
	 */
	let { sessionId, frames, pending = 0, onchanged }: { sessionId: string; frames: Frame[]; pending?: number; onchanged: () => void } = $props();

	const PAGE = 40;
	let filter = $state<'all' | 'accepted' | 'rejected'>('all');
	let limit = $state(PAGE);
	let busy = $state<string | null>(null);
	let failure = $state<string | null>(null);
	let viewing = $state<number | null>(null);

	const newestFirst = $derived([...frames].reverse());
	const shown = $derived(newestFirst.filter((f) => filter === 'all' || (filter === 'accepted') === f.accepted));
	const rejected = $derived(frames.filter((f) => !f.accepted).length);
	const current = $derived(viewing !== null ? shown[viewing] : null);

	async function decide(frame: Frame, accepted: boolean | null) {
		busy = frame.id;
		failure = null;
		try {
			const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/frames/${encodeURIComponent(frame.id)}`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ accepted })
			});
			if (!response.ok) throw new Error((await response.json().catch(() => null))?.message ?? `HTTP ${response.status}`);
			onchanged();
		} catch (e) {
			failure = `Frame ${frame.number ?? ''}: ${(e as Error).message}`;
		} finally {
			busy = null;
		}
	}

	$effect(() => {
		if (viewing === null) return;
		const key = (e: KeyboardEvent) => {
			if (e.key === 'Escape') viewing = null;
			else if (e.key === 'ArrowLeft' && viewing! > 0) viewing!--;
			else if (e.key === 'ArrowRight' && viewing! < shown.length - 1) viewing!++;
		};
		addEventListener('keydown', key);
		return () => removeEventListener('keydown', key);
	});
</script>

{#snippet buttons(f: Frame)}
	<div class="buttons">
		{#if f.accepted}
			<button disabled={busy === f.id} onclick={() => decide(f, false)}>Reject</button>
		{:else}
			<button disabled={busy === f.id} onclick={() => decide(f, true)}>Accept</button>
		{/if}
		{#if f.manual}<button disabled={busy === f.id} onclick={() => decide(f, null)} title="Back to the automatic decision">Auto</button>{/if}
	</div>
{/snippet}

{#snippet facts(f: Frame)}
	<span><b class="num">{f.stars ?? '–'}</b> stars</span>
	<span>HFR <b class="num">{fixed(f.hfr, 2)}</b></span>
	{#if f.fwhmPx !== null}<span>FWHM <b class="num">{fixed(f.fwhmPx, 1)}</b></span>{/if}
	{#if f.elongation !== null}<span>elong. <b class="num">{fixed(f.elongation, 2)}</b></span>{/if}
	<span>bg <b class="num">{f.backgroundAdu ?? '–'}</b></span>
	{#if f.guidingRmsArcsec !== null}<span>guide <b class="num">{arcsec(f.guidingRmsArcsec)}″</b></span>{/if}
{/snippet}

<Card title="Frames">
	{#snippet accessory()}
		<span class="num">{frames.length - rejected} in · {rejected} out{pending ? ` · ${pending} waiting` : ''}</span>
	{/snippet}
	<div class="filters" role="group" aria-label="Show">
		{#each [['all', 'All'], ['accepted', 'Accepted'], ['rejected', 'Rejected']] as [value, label] (value)}
			<button class:on={filter === value} onclick={() => ((filter = value as typeof filter), (limit = PAGE))}>{label}</button>
		{/each}
	</div>
	{#if failure}<p class="warn small">Not saved: {failure}</p>{/if}
	{#if shown.length === 0}
		<p class="muted small">{frames.length ? 'None.' : 'No frames processed yet.'}</p>
	{:else}
		<ol class="list">
			{#each shown.slice(0, limit) as f, i (f.id)}
				<li class:rej={!f.accepted}>
					<button class="thumb" onclick={() => (viewing = i)} aria-label="Open frame {f.number ?? ''}">
						<img src="/frames/{f.id}-small.jpg" alt="" loading="lazy" width="64" height="64" />
					</button>
					<div class="body">
						<div class="top">
							<span class="no num">#{f.number ?? '–'}</span>
							<span class="num muted">{clock(f.at * 1000)}</span>
							<span class="chip" class:out={!f.accepted}>{f.accepted ? 'In stack' : 'Rejected'}{f.manual ? ' · by hand' : ''}</span>
							{#if f.aligned === false}<span class="chip out">not aligned</span>{/if}
						</div>
						{#if f.rejectReason}<p class="reason">{f.rejectReason}</p>{/if}
						<div class="facts">{@render facts(f)}</div>
					</div>
					{@render buttons(f)}
				</li>
			{/each}
		</ol>
		{#if shown.length > limit}
			<button class="more" onclick={() => (limit += 200)}>Show {Math.min(200, shown.length - limit)} more of {shown.length - limit}</button>
		{/if}
	{/if}
</Card>

{#if current && viewing !== null}
	<div class="viewer" use:portal role="dialog" aria-modal="true" aria-label="Frame {current.number ?? ''}">
		<img src="/frames/{current.id}.jpg" alt="Frame {current.number ?? ''}" />
		<div class="vbar">
			<div class="vinfo">
				<div class="top">
					<span class="no num">#{current.number ?? '–'}</span>
					<span class="num muted">{clock(current.at * 1000)}</span>
					<span class="chip" class:out={!current.accepted}>{current.accepted ? 'In stack' : 'Rejected'}{current.manual ? ' · by hand' : ''}</span>
				</div>
				{#if current.rejectReason}<p class="reason">{current.rejectReason}</p>{/if}
				<div class="facts">{@render facts(current)}</div>
			</div>
			{@render buttons(current)}
			<div class="nav">
				<button disabled={viewing === 0} onclick={() => viewing!--} aria-label="Newer">←</button>
				<button disabled={viewing === shown.length - 1} onclick={() => viewing!++} aria-label="Older">→</button>
				<button onclick={() => (viewing = null)} aria-label="Close">✕</button>
			</div>
		</div>
	</div>
{/if}

<style>
	p {
		margin: 0;
	}
	.small {
		font-size: 13px;
	}
	.filters {
		display: flex;
		gap: 6px;
	}
	button {
		padding: 5px 11px;
		border-radius: 999px;
		border: 1px solid var(--border);
		background: var(--surface);
		color: var(--muted);
		font-size: 12px;
		font-weight: 600;
		cursor: pointer;
	}
	button.on {
		background: var(--surface-strong);
		color: var(--text);
	}
	button:disabled {
		cursor: default;
		opacity: 0.55;
	}
	button.on:disabled {
		opacity: 1;
	}
	.list {
		margin: 0;
		padding: 0;
		list-style: none;
		display: flex;
		flex-direction: column;
	}
	.list li {
		display: grid;
		grid-template-columns: 64px 1fr auto;
		gap: 10px;
		align-items: center;
		padding: 8px 0;
		border-top: 1px solid var(--border);
	}
	.list li.rej .thumb img {
		opacity: 0.55;
	}
	.thumb {
		padding: 0;
		border: 0;
		border-radius: 8px;
		overflow: hidden;
		width: 64px;
		height: 64px;
		background: #000;
	}
	.thumb img {
		display: block;
		width: 64px;
		height: 64px;
		object-fit: cover;
	}
	.body {
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 3px;
	}
	.top {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 4px 8px;
		font-size: 13px;
	}
	.no {
		font-weight: 650;
	}
	.chip {
		padding: 1px 7px;
		border-radius: 999px;
		font-size: 11px;
		font-weight: 600;
		color: var(--ok);
		border: 1px solid currentColor;
	}
	.chip.out {
		color: var(--warn);
	}
	.reason {
		font-size: 13px;
		color: var(--warn);
	}
	.facts {
		display: flex;
		flex-wrap: wrap;
		gap: 2px 10px;
		font-size: 12px;
		color: var(--muted);
	}
	.facts b {
		color: var(--text);
		font-weight: 550;
	}
	.buttons {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.more {
		align-self: center;
	}
	.viewer {
		position: fixed;
		inset: 0;
		z-index: 50;
		background: #000;
		display: flex;
		flex-direction: column;
		padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left);
	}
	.viewer img {
		flex: 1;
		min-height: 0;
		width: 100%;
		object-fit: contain;
	}
	.vbar {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 10px 14px;
		padding: 10px 14px;
	}
	.vinfo {
		flex: 1 1 220px;
		display: flex;
		flex-direction: column;
		gap: 3px;
	}
	.vbar .buttons {
		flex-direction: row;
	}
	.nav {
		display: flex;
		gap: 6px;
	}
	.nav button {
		font-size: 15px;
		padding: 6px 13px;
	}
	@media (max-width: 480px) {
		.list li {
			grid-template-columns: 56px 1fr auto;
			gap: 8px;
		}
		.thumb,
		.thumb img {
			width: 56px;
			height: 56px;
		}
	}
</style>
