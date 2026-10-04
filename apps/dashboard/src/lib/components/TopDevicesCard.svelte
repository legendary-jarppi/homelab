<script lang="ts">
	import Card from './Card.svelte';
	import { formatBits } from '$lib/format';
	import type { LiveData } from '$lib/types';

	let { top, limit = 5 }: { top: LiveData['top']; limit?: number } = $props();

	const shown = $derived(top.slice(0, limit));
	const busiest = $derived(Math.max(1, ...shown.map((d) => d.downBps + d.upBps)));
</script>

<Card title="Top devices">
	{#snippet accessory()}<span>right now</span>{/snippet}
	<ul>
		{#each shown as device (device.mac)}
			{@const down = formatBits(device.downBps)}
			{@const up = formatBits(device.upBps)}
			<li>
				<span class="icon" title={device.wired ? 'Wired' : 'Wi-Fi'}>
					{#if device.wired}
						<svg viewBox="0 0 24 24"><path d="M7 21v-4H5V9h3V3h8v6h3v8h-2v4z" /></svg>
					{:else}
						<svg viewBox="0 0 24 24"><path d="M2 9a15 15 0 0 1 20 0M5.5 12.5a10 10 0 0 1 13 0M9 16a5 5 0 0 1 6 0" /><circle cx="12" cy="19.5" r="1.2" /></svg>
					{/if}
				</span>
				<div class="who">
					<span class="name">
						{device.name}{#if device.vendor && device.vendor !== device.name}<span class="vendor muted">{device.vendor}</span>{/if}
					</span>
					<div class="track">
						<span class="seg down" style:width="{(device.downBps / busiest) * 100}%"></span>
						<span class="seg up" style:width="{(device.upBps / busiest) * 100}%"></span>
					</div>
				</div>
				<div class="rates num">
					<span class="down">↓ {down.value} <small>{down.unit}</small></span>
					<span class="up">↑ {up.value} <small>{up.unit}</small></span>
				</div>
			</li>
		{:else}
			<li class="muted">No client traffic.</li>
		{/each}
	</ul>
</Card>

<style>
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 9px;
	}
	li {
		display: flex;
		align-items: center;
		gap: 11px;
		min-width: 0;
	}
	.icon {
		width: 30px;
		height: 30px;
		flex: none;
		display: grid;
		place-items: center;
		border-radius: 10px;
		background: var(--surface-strong);
		color: var(--muted);
	}
	.icon svg {
		width: 16px;
		height: 16px;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.8;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
	.icon circle {
		fill: currentColor;
		stroke: none;
	}
	.who {
		flex: 1;
		min-width: 0;
		display: grid;
		gap: 3px;
	}
	.name {
		font-size: 14px;
		font-weight: 550;
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
	}
	.vendor {
		margin-left: 8px;
		font-size: 12px;
		font-weight: 400;
	}
	.track {
		display: flex;
		height: 4px;
		border-radius: 2px;
		background: rgba(255, 255, 255, 0.06);
		overflow: hidden;
	}
	.seg {
		height: 100%;
		transition: width 0.8s cubic-bezier(0.2, 0.8, 0.2, 1);
	}
	.seg.down {
		background: var(--down);
	}
	.seg.up {
		background: var(--up);
	}
	.rates {
		display: grid;
		justify-items: end;
		font-size: 13px;
		font-weight: 600;
		white-space: nowrap;
	}
	.rates small {
		font-weight: 400;
		color: var(--muted);
	}
	.rates .down {
		color: var(--down);
	}
	.rates .up {
		color: var(--up);
	}
</style>
