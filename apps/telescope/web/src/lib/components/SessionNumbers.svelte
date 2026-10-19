<script lang="ts">
	import Card from './Card.svelte';
	import { clock, fixed, formatBytes, formatDec, formatDuration, formatRa } from '$lib/format';
	import type { SessionDetail } from '$lib/types';

	/** D5: the session in numbers (frames, integration, equipment, coordinates, archive) and why frames were left out. */
	let { session }: { session: SessionDetail } = $props();

	const rejected = $derived(session.frames.filter((f) => !f.accepted));
	const median = (values: number[]) => {
		const s = values.filter(Number.isFinite).sort((a, b) => a - b);
		return s.length ? s[Math.floor(s.length / 2)] : null;
	};
	const accepted = $derived(session.frames.filter((f) => f.accepted));
	const hfr = $derived(median(accepted.map((f) => f.hfr ?? NaN)));
	const stars = $derived(median(accepted.map((f) => f.stars ?? NaN)));
	const byHand = $derived(session.frames.filter((f) => f.manual).length);
</script>

<Card title="Session">
	<dl class="facts">
		<div><dt>Frames</dt><dd class="num">{session.frames.length}{session.pending ? ` + ${session.pending} waiting` : ''}</dd></div>
		<div><dt>In stack</dt><dd class="num">{session.accepted}</dd></div>
		<div><dt>Rejected</dt><dd class="num" class:warn={session.rejected > 0}>{session.rejected}</dd></div>
		<div><dt>Integration</dt><dd class="num">{formatDuration(session.integrationS)}</dd></div>
		<div><dt>Exposure</dt><dd class="num">{session.exposureS ?? '–'} s{session.gain !== null ? ` · gain ${session.gain}` : ''}</dd></div>
		<div><dt>Time</dt><dd class="num">{clock(session.firstFrameAt * 1000)}–{clock(session.lastFrameAt * 1000)}</dd></div>
		<div><dt>Median HFR</dt><dd class="num">{fixed(hfr, 2)} px</dd></div>
		<div><dt>Median stars</dt><dd class="num">{fixed(stars)}</dd></div>
		{#if session.ra !== null && session.dec !== null}
			<div class="wide"><dt>Target RA / Dec</dt><dd class="num">{formatRa(session.ra)} · {formatDec(session.dec)}</dd></div>
		{/if}
		{#if session.camera}<div class="wide"><dt>Camera</dt><dd>{session.camera}{session.focalLengthMm ? ` · ${session.focalLengthMm} mm` : ''}</dd></div>{/if}
		{#if session.archive}<div class="wide"><dt>Archived at home</dt><dd class="num">{session.archive.frames} files · {formatBytes(session.archive.bytes)}</dd></div>{/if}
	</dl>
	{#if rejected.length}
		<div class="rej">
			<h3>Rejected{byHand ? ` · ${byHand} decided by hand` : ''}</h3>
			<ul>
				{#each rejected as f (f.id)}
					<li><span class="num muted">#{f.number ?? '–'} {clock(f.at * 1000)}</span><span>{f.rejectReason ?? 'rejected'}{f.manual ? ' (by hand)' : ''}</span></li>
				{/each}
			</ul>
		</div>
	{/if}
</Card>

<style>
	.facts {
		margin: 0;
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(118px, 1fr));
		gap: 10px 16px;
	}
	.facts .wide {
		grid-column: span 2;
	}
	dt {
		font-size: 12px;
		color: var(--muted);
	}
	dd {
		margin: 2px 0 0;
		font-size: 16px;
		font-weight: 600;
	}
	h3 {
		margin: 4px 0 6px;
		font-size: 13px;
		font-weight: 600;
		color: var(--muted);
	}
	ul {
		margin: 0;
		padding: 0;
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: 4px;
		font-size: 13px;
	}
	li {
		display: grid;
		grid-template-columns: 100px 1fr;
		gap: 8px;
	}
</style>
