<script lang="ts">
	import Card from './Card.svelte';
	import Meter from './Meter.svelte';
	import { formatDuration } from '$lib/format';
	import type { LiveData } from '$lib/types';

	let { live }: { live: LiveData } = $props();

	const offline = $derived(live.devices.filter((d) => !d.online).length);
	const TYPE_LABEL: Record<string, string> = { udm: 'Gateway', ugw: 'Gateway', usg: 'Gateway', uxg: 'Gateway', usw: 'Switch', uap: 'Access point' };
</script>

<Card title="Network">
	{#snippet accessory()}
		<span class="state" class:bad={offline > 0}>
			<i></i>{offline > 0 ? `${offline} offline` : 'All online'}
		</span>
	{/snippet}
	<div class="clients">
		<span class="value num">{live.clients.total}</span>
		<div class="split muted">
			<span>clients</span>
			<span class="num">{live.clients.wireless} Wi-Fi · {live.clients.wired} wired</span>
		</div>
		{#if live.gateway}
			<div class="gw muted num">
				{#if live.gateway.temperatureC !== null}<span>{Math.round(live.gateway.temperatureC)} °C</span>{/if}
				<span>up {formatDuration(live.gateway.uptimeS)}</span>
			</div>
		{/if}
	</div>
	{#if live.gateway}
		<div class="meters">
			<Meter label="Gateway CPU" value={live.gateway.cpu} />
			<Meter label="Memory" value={live.gateway.memory} />
		</div>
	{/if}
	<ul class="devices">
		{#each live.devices as device}
			<li title="{TYPE_LABEL[device.type] ?? device.type} · {device.model}">
				<i class:off={!device.online}></i>
				<span class="name">{device.name}</span>
				{#if device.clients !== null}<span class="count muted num">{device.clients}</span>{/if}
			</li>
		{/each}
	</ul>
</Card>

<style>
	.state {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		color: var(--ok);
	}
	.state.bad {
		color: var(--bad);
	}
	.state i,
	.devices i {
		width: 7px;
		height: 7px;
		flex: none;
		border-radius: 50%;
		background: var(--ok);
		box-shadow: 0 0 8px rgba(52, 211, 153, 0.7);
	}
	.state.bad i,
	.devices i.off {
		background: var(--bad);
		box-shadow: 0 0 8px rgba(248, 113, 113, 0.7);
	}
	.clients {
		display: flex;
		align-items: center;
		gap: 10px;
	}
	.clients .value {
		font-size: 38px;
		font-weight: 650;
		line-height: 1;
	}
	.split {
		display: grid;
		font-size: 12px;
	}
	.gw {
		margin-left: auto;
		display: grid;
		justify-items: end;
		font-size: 12px;
	}
	.meters {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 14px;
	}
	.devices {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 6px 14px;
		font-size: 13px;
	}
	.devices li {
		display: flex;
		align-items: center;
		gap: 7px;
		min-width: 0;
	}
	.name {
		flex: 1;
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
	}
	.count {
		font-size: 12px;
	}
</style>
