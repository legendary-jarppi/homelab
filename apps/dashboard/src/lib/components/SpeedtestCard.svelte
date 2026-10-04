<script lang="ts">
	import Card from './Card.svelte';
	import { formatAgo } from '$lib/format';
	import type { SlowData } from '$lib/types';

	let { speedtest }: { speedtest: SlowData['speedtest'] } = $props();

	const history = $derived(speedtest?.history.slice(-14) ?? []);
	const peak = $derived(Math.max(1, ...history.flatMap((h) => [h.downMbps, h.upMbps])));
</script>

<Card title="Speed test">
	{#snippet accessory()}
		{#if speedtest}<span>{formatAgo(speedtest.ranAt)}</span>{/if}
	{/snippet}
	{#if speedtest}
		<div class="results">
			<div>
				<span class="label down">Down</span>
				<span class="value num">{Math.round(speedtest.downMbps)}<small>Mb/s</small></span>
			</div>
			<div>
				<span class="label up">Up</span>
				<span class="value num">{Math.round(speedtest.upMbps)}<small>Mb/s</small></span>
			</div>
		</div>
		<div class="latency muted num">{speedtest.latencyMs < 1 ? '<1' : Math.round(speedtest.latencyMs)} ms ping</div>
		{#if history.length > 1}
			<div class="bars" aria-label="Recent speed tests">
				{#each history as run (run.ranAt)}
					<div class="pair" title="{new Date(run.ranAt * 1000).toLocaleString()}: {Math.round(run.downMbps)} / {Math.round(run.upMbps)} Mb/s">
						<span class="bar down" style:height="{(run.downMbps / peak) * 100}%"></span>
						<span class="bar up" style:height="{(run.upMbps / peak) * 100}%"></span>
					</div>
				{/each}
			</div>
		{/if}
	{:else}
		<p class="muted">No speed test results yet. UniFi runs them on its schedule.</p>
	{/if}
</Card>

<style>
	.results {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 12px;
	}
	.results > div {
		display: grid;
	}
	.label {
		font-size: 13px;
		font-weight: 600;
	}
	.label.down {
		color: var(--down);
	}
	.label.up {
		color: var(--up);
	}
	.value {
		font-size: 34px;
		font-weight: 650;
		line-height: 1.1;
	}
	.value small {
		margin-left: 4px;
		font-size: 0.4em;
		font-weight: 500;
		color: var(--muted);
	}
	.latency {
		font-size: 13px;
	}
	.bars {
		margin-top: auto;
		height: 48px;
		display: flex;
		justify-content: flex-end;
		align-items: flex-end;
		gap: 5px;
	}
	.pair {
		flex: 1;
		max-width: 22px;
		height: 100%;
		display: flex;
		align-items: flex-end;
		gap: 2px;
	}
	.bar {
		flex: 1;
		min-height: 2px;
		border-radius: 3px 3px 1px 1px;
	}
	.bar.down {
		background: linear-gradient(to top, rgba(56, 189, 248, 0.35), var(--down));
	}
	.bar.up {
		background: linear-gradient(to top, rgba(192, 132, 252, 0.35), var(--up));
	}
	p {
		margin: 0;
		font-size: 14px;
	}
</style>
