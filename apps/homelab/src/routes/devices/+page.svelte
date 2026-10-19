<script lang="ts">
	import { untrack } from 'svelte';
	import Card from '$lib/components/Card.svelte';
	import { SITES, type SiteId } from '$lib/architecture';
	import { DEVICES, clientOf, deviceChecks, deviceTone, otherClients } from '$lib/devices';
	import { formatDuration } from '$lib/format';
	import { liveStatus } from '$lib/live.svelte';

	/**
	 * Every device outside the cluster from the model ($lib/architecture), with how it is connected and
	 * its live status; then the UniFi gear and the network clients the model does not name.
	 */
	let { data } = $props();
	const live = liveStatus(untrack(() => data.status));

	const sites = Object.keys(SITES) as SiteId[];
	const others = $derived(otherClients(live.data));
</script>

<svelte:head><title>Devices · Homelab</title></svelte:head>

{#if live.failed}<p class="warn">Live status unavailable (Prometheus); showing the model only.</p>{/if}

{#each sites as site (site)}
	<Card title="{SITES[site].label} · {SITES[site].lan}">
		{#snippet accessory()}
			{@const up = live.data?.consoles[site]}
			<span class="console"><i class="dot {up === true ? 'ok' : up === false ? 'bad' : 'unknown'}"></i>UniFi console {SITES[site].console.replace('https://', '')}: {up === true ? 'reporting' : up === false ? 'not reachable' : 'no data'}</span>
		{/snippet}
		<div class="devices" role="table" aria-label="{SITES[site].label} devices">
			<div class="row head" role="row">
				<span role="columnheader">Device</span>
				<span role="columnheader">Address</span>
				<span role="columnheader">Connected to</span>
				<span role="columnheader">Status</span>
			</div>
			{#each DEVICES.filter((d) => d.device.site === site) as d (d.node.id)}
				{@const checks = deviceChecks(d.device, live.data)}
				{@const overall = deviceTone(d.device, checks)}
				{@const client = clientOf(d.device, live.data)}
				{@const links = data.links[d.node.id]}
				<div class="row" class:planned={d.device.planned} role="row">
					<div class="cell what" role="cell">
						<b>{d.node.label}</b>
						{#if d.node.sub}<span class="muted">{d.node.sub}</span>{/if}
						<span class="info">{d.node.info}</span>
						{#if links?.docs}<a href={links.docs}>Docs →</a>{/if}
					</div>
					<div class="cell num" role="cell">
						<span class="label">Address</span>
						{d.device.address ?? '–'}
						{#if d.device.client && 'mac' in d.device.client}<span class="mono muted">{d.device.client.mac}</span>{/if}
						{#if client && client.ip !== d.device.address}<span class="muted">now {client.ip}</span>{/if}
					</div>
					<div class="cell" role="cell">
						<span class="label">Connected to</span>
						{#if d.connections.length === 0}<span class="muted">–</span>{/if}
						<ul class="conns">
							{#each d.connections as c (c.id + c.via)}
								<li><i class="swatch {c.kind}"></i><span><b>{c.outgoing ? '→' : '←'} {c.label}</b> <span class="muted">{c.group}</span><br /><span class="via">{c.via}</span></span></li>
							{/each}
						</ul>
					</div>
					<div class="cell" role="cell">
						<span class="label">Status</span>
						<span class="overall {overall.tone}"><i class="dot {overall.tone}"></i>{overall.text}</span>
						{#if d.device.planned && links?.plan}<a href={links.plan}>The plan →</a>{/if}
						<ul class="checks">
							{#each checks as c (c.label)}
								<li><i class="dot {c.tone}"></i><span>{c.label}: <span class:muted={c.tone === 'unknown'}>{c.text}</span></span></li>
							{/each}
						</ul>
					</div>
				</div>
			{/each}
		</div>
	</Card>
{/each}

<div class="pair">
	<Card title="UniFi gear">
		{#if !live.data}<p class="muted">No data.</p>{/if}
		<div class="scroll"><table class="num">
			<thead><tr><th>Site</th><th>Name</th><th>Model</th><th>Address</th><th>Up</th></tr></thead>
			<tbody>
				{#each live.data?.gear ?? [] as g (g.site + g.mac)}
					<tr><td>{SITES[g.site].label}</td><td>{g.name}</td><td>{g.model}</td><td>{g.ip}</td><td>{formatDuration(g.uptimeS)}</td></tr>
				{/each}
			</tbody>
		</table></div>
		<p class="note muted">Consoles, switches and access points as UnPoller reports them; a site whose console is not reporting has none listed.</p>
	</Card>
	<Card title="Other network clients">
		<p class="note muted">Connected now, from UniFi, but not in the model: phones, computers and devices nothing in the homelab talks to. Add a device to <code>apps/homelab/src/lib/architecture.ts</code> when an app starts using one.</p>
		<div class="scroll"><table class="num">
			<thead><tr><th>Site</th><th>Name</th><th>Address</th><th>Connection</th><th>Connected</th></tr></thead>
			<tbody>
				{#each sites as site (site)}
					{#each others[site] as c (c.site + c.mac)}
						<tr>
							<td>{SITES[site].label}</td>
							<td>{c.name}</td>
							<td>{c.ip}<br /><span class="mono muted">{c.mac}</span></td>
							<td>{c.wired ? 'wired' : 'Wi-Fi'}, {c.via}</td>
							<td>{formatDuration(c.uptimeS)}</td>
						</tr>
					{/each}
				{/each}
			</tbody>
		</table></div>
	</Card>
</div>

<style>
	.warn {
		margin: 0;
		font-size: 13px;
		color: var(--warn);
	}
	.console {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-size: 12px;
	}
	.devices {
		display: flex;
		flex-direction: column;
		font-size: 13px;
		line-height: 1.4;
	}
	.row {
		display: grid;
		grid-template-columns: minmax(0, 2.2fr) minmax(0, 1fr) minmax(0, 1.9fr) minmax(0, 1.6fr);
		gap: 6px 16px;
		padding: 10px 0;
		border-top: 1px solid var(--border);
	}
	.row.head {
		padding: 0 0 6px;
		border-top: 0;
		font-size: 12px;
		font-weight: 600;
		color: var(--muted);
	}
	.row.planned {
		opacity: 0.75;
	}
	.cell {
		display: flex;
		flex-direction: column;
		gap: 3px;
		min-width: 0;
	}
	.what b {
		font-size: 14px;
	}
	.info {
		color: var(--muted);
		font-size: 12px;
	}
	.label {
		display: none;
	}
	a {
		color: var(--down);
		text-decoration: none;
		font-weight: 600;
		font-size: 12px;
	}
	.mono,
	code {
		font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
		font-size: 11px;
	}
	ul {
		margin: 0;
		padding: 0;
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: 5px;
	}
	.conns li,
	.checks li {
		display: flex;
		align-items: baseline;
		gap: 7px;
	}
	.via {
		color: var(--muted);
		font-size: 12px;
	}
	.overall {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-weight: 600;
	}
	.overall.ok {
		color: var(--ok);
	}
	.overall.warn {
		color: var(--warn);
	}
	.overall.bad {
		color: var(--bad);
	}
	.overall.planned,
	.overall.unknown {
		color: var(--muted);
	}
	.checks {
		font-size: 12px;
	}
	.dot {
		flex: none;
		display: inline-block;
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: var(--faint);
	}
	.dot.ok {
		background: var(--ok);
	}
	.dot.warn {
		background: var(--warn);
	}
	.dot.bad {
		background: var(--bad);
	}
	.dot.planned {
		background: transparent;
		border: 1px dashed var(--muted);
	}
	.swatch {
		flex: none;
		display: inline-block;
		width: 12px;
		height: 3px;
		border-radius: 2px;
		background: var(--c);
		transform: translateY(-3px);
	}
	/* Connection colours, as in the diagrams. */
	.web {
		--c: #38bdf8;
	}
	.video {
		--c: #fbbf24;
	}
	.mqtt {
		--c: #34d399;
	}
	.data {
		--c: #c084fc;
	}
	.metrics {
		--c: #94a3b8;
	}
	.control {
		--c: #cbd5e1;
	}
	.internet {
		--c: #f472b6;
	}
	.pair {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 1.4fr);
		gap: 12px;
		align-items: start;
	}
	table {
		width: 100%;
		border-collapse: collapse;
		font-size: 13px;
	}
	th {
		text-align: left;
		font-size: 12px;
		font-weight: 600;
		color: var(--muted);
		padding: 0 10px 6px 0;
	}
	td {
		padding: 6px 10px 6px 0;
		border-top: 1px solid var(--border);
		vertical-align: top;
	}
	.note {
		margin: 0;
		font-size: 12px;
	}
	.scroll {
		overflow-x: auto;
	}

	/* Narrow screens: each device as a block, the columns one under the other with their names. */
	@media (max-width: 900px) {
		.row {
			grid-template-columns: minmax(0, 1fr);
		}
		.row.head {
			display: none;
		}
		.label {
			display: block;
			font-size: 11px;
			font-weight: 700;
			letter-spacing: 0.06em;
			text-transform: uppercase;
			color: var(--faint);
		}
		.pair {
			grid-template-columns: minmax(0, 1fr);
		}
	}
</style>
