<script lang="ts">
	import { untrack } from 'svelte';
	import Card from '$lib/components/Card.svelte';
	import { COMPONENTS, SITES, nodeWorkloads, workloadsStatus, type SiteId } from '$lib/architecture';
	import { backupProblem } from '$lib/backup';
	import { formatAgo, formatDuration } from '$lib/format';
	import { liveStatus } from '$lib/live.svelte';

	/** The two sites, the cluster's health and every app and platform UI with its addresses and status. */
	let { data } = $props();
	const live = liveStatus(untrack(() => data.status));

	const percent = (v: number | null | undefined) => (v === null || v === undefined ? '–' : `${Math.round(v * 100)} %`);

	const consoleText = (up: boolean | null | undefined) => (up === true ? 'reporting' : up === false ? 'not reachable' : 'no data');
	const clientCount = (site: SiteId) => live.data?.clients.filter((c) => c.site === site).length ?? 0;

	/** Workloads ready (all pods ready; a CronJob: succeeded in the last 26 h) and the ones that are not. */
	const workloads = $derived.by(() => {
		const entries = Object.entries(live.data?.workloads ?? {});
		const notReady = entries
			.filter(([, w]) =>
				w.kind === 'CronJob' ? w.lastSuccess == null || Date.now() - w.lastSuccess > 26 * 3_600_000 : w.pods.length === 0 || w.pods.some((p) => !p.ready)
			)
			.map(([key]) => key)
			.sort();
		const restarts = entries.reduce((sum, [, w]) => sum + w.pods.reduce((s, p) => s + p.restarts24h, 0), 0);
		return { total: entries.length, notReady, restarts };
	});
	const backup = $derived(live.data ? backupProblem(live.data.cluster.backup, Date.now()) : null);

	const apps = COMPONENTS.groups.flatMap((g) => (g.app ? [{ group: g, app: g.app }] : [])).sort((a, b) => Number(a.app.kind === 'platform') - Number(b.app.kind === 'platform'));
	const appStatus = (group: (typeof apps)[number]['group']) => {
		if (!live.data) return null;
		const keys = new Map(group.nodes.flatMap((n) => nodeWorkloads(n, live.data)));
		return workloadsStatus([...keys], Date.now());
	};
</script>

<svelte:head><title>Homelab</title></svelte:head>

{#if live.failed}<p class="warn">Live status unavailable (Prometheus); showing the structure only.</p>{/if}

<div class="top">
	<Card title="Home · {SITES.home.lan}">
		<ul class="facts">
			<li>
				<i class="dot {live.data?.consoles.home === true ? 'ok' : live.data?.consoles.home === false ? 'bad' : ''}"></i>
				<div><b>UDM Pro</b> <span class="num">192.168.1.1</span><span class="muted">Router, firewall, DNS for lab.internal, DHCP, Protect. UniFi data: {consoleText(live.data?.consoles.home)}{live.data?.consoles.home ? ` · ${clientCount('home')} clients connected` : ''}</span></div>
			</li>
			<li>
				<i class="dot {live.data?.cluster.nodeReady === true ? 'ok' : live.data?.cluster.nodeReady === false ? 'bad' : ''}"></i>
				<div>
					<b>k3s node</b> <span class="num">192.168.1.10</span>
					<span class="muted num">
						{live.data?.cluster.node ?? 'shilly-shally-lab-01'} · single node{live.data?.cluster.kubelet ? ` · ${live.data.cluster.kubelet}` : ''}
						{#if live.data}<br />{live.data.cluster.nodeReady ? 'Ready' : 'Not ready'} · up {formatDuration(live.data.cluster.uptimeS)} · CPU {percent(live.data.cluster.cpu)} · memory {percent(live.data.cluster.memory)}{/if}
					</span>
				</div>
			</li>
		</ul>
		<p class="more"><a href="/network">Network</a> · <a href="/devices">Devices</a> · <a href="/docs/platform/README.md#network">Ports and firewall</a></p>
	</Card>
	<Card title="Cabin · {SITES.cabin.lan}">
		<ul class="facts">
			<li>
				<i class="dot {live.data?.consoles.cabin === true ? 'ok' : live.data?.consoles.cabin === false ? 'bad' : ''}"></i>
				<div><b>UCG Max</b> <span class="num">192.168.20.1</span><span class="muted">UniFi console behind a Teltonika RUTX50 on mobile (link 10.200.0.0/24). UniFi data over the VPN: {consoleText(live.data?.consoles.cabin)}{live.data?.consoles.cabin ? ` · ${clientCount('cabin')} clients connected` : ''}</span></div>
			</li>
			<li>
				<i class="dot {live.data?.consoles.cabin === true ? 'ok' : live.data?.consoles.cabin === false ? 'bad' : ''}"></i>
				<div><b>Site Magic VPN</b><span class="muted">Mesh between the consoles: 192.168.1.0/24 ↔ 192.168.20.0/24; the cabin resolves *.lab.internal through the UDM Pro. Up while UnPoller reaches the UCG Max.</span></div>
			</li>
		</ul>
		<p class="more"><a href="/network">Network</a> · <a href="/devices">Devices</a> · <a href="/docs/docs/other-site-network.md">Site-to-site notes</a></p>
	</Card>
	<Card title="Cluster">
		{#if live.data}
			<ul class="facts">
				<li>
					<i class="dot {workloads.notReady.length === 0 ? 'ok' : 'warn'}"></i>
					<div>
						<b class="num">{workloads.total - workloads.notReady.length} of {workloads.total} workloads ready</b>
						{#if workloads.notReady.length > 0}<span class="warnText">Not ready: {workloads.notReady.join(', ')}</span>{/if}
					</div>
				</li>
				<li>
					<i class="dot {workloads.restarts === 0 ? 'ok' : 'warn'}"></i>
					<div><b class="num">{workloads.restarts} container restart{workloads.restarts === 1 ? '' : 's'} in 24 h</b></div>
				</li>
				<li>
					<i class="dot {live.data.cluster.targetsDown === 0 ? 'ok' : 'warn'}"></i>
					<div><b class="num">{live.data.cluster.targetsDown ?? '–'} scrape target{live.data.cluster.targetsDown === 1 ? '' : 's'} down</b><span class="muted">Prometheus targets not answering</span></div>
				</li>
				<li>
					<i class="dot {backup ? 'warn' : 'ok'}"></i>
					<div>
						<b>{backup ?? (live.data.cluster.backup.running ? 'Backup running' : 'Backup OK')}</b>
						{#if live.data.cluster.backup.lastSuccess}<span class="muted">Last success {formatAgo(live.data.cluster.backup.lastSuccess)} · nightly at 03:30</span>{/if}
					</div>
				</li>
			</ul>
			<p class="more"><a href="/components">Components</a> · <a href="http://grafana.lab.internal" target="_blank" rel="noopener">Grafana ↗</a></p>
		{:else}
			<p class="muted">No data from Prometheus.</p>
		{/if}
	</Card>
</div>

<Card title="Apps and platform">
	<div class="scroll">
		<table>
			<thead><tr><th>Name</th><th>Addresses</th><th>Purpose</th><th>Status</th></tr></thead>
			<tbody>
				{#each apps as { group, app } (group.id)}
					{@const s = appStatus(group)}
					<tr>
						<td class="name">
							{#if data.docs[group.id]}<a href={data.docs[group.id]}>{group.label}</a>{:else}{group.label}{/if}
							{#if app.kind === 'platform'}<span class="tag">platform</span>{/if}
						</td>
						<td class="addresses">
							{#each app.lab ?? [] as a (a)}<span><i class="kind">lab</i><a href="http://{a}" target="_blank" rel="noopener">{a}</a></span>{/each}
							{#each app.public ?? [] as a (a)}<span><i class="kind">public</i>{#if a.includes(' ')}{a}{:else}<a href="https://{a}" target="_blank" rel="noopener">{a}</a>{/if}</span>{/each}
							{#each app.lan ?? [] as a (a)}<span><i class="kind">LAN</i>{a}</span>{/each}
							{#each app.internal ?? [] as a (a)}<span><i class="kind">cluster</i><span class="mono">{a}</span></span>{/each}
						</td>
						<td class="purpose">{app.purpose}</td>
						<td class="status">{#if s}<i class="dot {s.tone}"></i><span class="num {s.tone}">{s.text}</span>{:else}<span class="muted">–</span>{/if}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
	<p class="note muted">Addresses: <i class="kind">lab</i> home network and VPN (Traefik), <i class="kind">public</i> Cloudflare Tunnel behind Access, <i class="kind">LAN</i> the server's address, <i class="kind">cluster</i> cluster-internal only.</p>
</Card>

<style>
	.warn {
		margin: 0;
		font-size: 13px;
		color: var(--warn);
	}
	.top {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 12px;
	}
	.facts {
		margin: 0;
		padding: 0;
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: 12px;
		font-size: 14px;
		line-height: 1.4;
	}
	.facts li {
		display: flex;
		align-items: baseline;
		gap: 10px;
	}
	.facts li > div {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}
	.facts .muted,
	.warnText {
		font-size: 12.5px;
	}
	.warnText {
		color: var(--warn);
	}
	.more {
		margin: auto 0 0;
		font-size: 13px;
		color: var(--faint);
	}
	a {
		color: var(--down);
		text-decoration: none;
	}
	.dot {
		flex: none;
		display: inline-block;
		width: 8px;
		height: 8px;
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
	.scroll {
		overflow-x: auto;
	}
	table {
		width: 100%;
		border-collapse: collapse;
		font-size: 14px;
	}
	th {
		text-align: left;
		font-size: 12px;
		font-weight: 600;
		color: var(--muted);
		padding: 0 14px 8px 0;
	}
	td {
		padding: 9px 14px 9px 0;
		border-top: 1px solid var(--border);
		vertical-align: top;
	}
	.name {
		font-weight: 600;
		white-space: nowrap;
	}
	.name a {
		color: var(--text);
	}
	.name a:hover {
		color: var(--down);
	}
	.tag {
		margin-left: 6px;
		padding: 1px 6px;
		font-size: 10px;
		font-weight: 600;
		border-radius: 999px;
		color: var(--muted);
		background: var(--surface-strong);
	}
	.addresses {
		display: flex;
		flex-direction: column;
		gap: 3px;
		font-size: 13px;
	}
	.addresses > span {
		display: flex;
		align-items: baseline;
		gap: 6px;
		white-space: nowrap;
	}
	.kind {
		flex: none;
		min-width: 46px;
		font-style: normal;
		font-size: 10px;
		font-weight: 700;
		letter-spacing: 0.05em;
		text-transform: uppercase;
		color: var(--faint);
	}
	.note .kind {
		min-width: 0;
		margin-left: 4px;
	}
	.mono {
		font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
		font-size: 12px;
		color: var(--muted);
	}
	.purpose {
		color: var(--muted);
		min-width: 200px;
	}
	.status {
		white-space: nowrap;
		font-size: 13px;
	}
	.status .dot {
		margin-right: 7px;
	}
	.status .warn {
		color: var(--warn);
	}
	.status .bad {
		color: var(--bad);
	}
	.note {
		margin: 0;
		font-size: 12px;
	}

	@media (max-width: 1100px) {
		.top {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}
	@media (max-width: 700px) {
		.top {
			grid-template-columns: minmax(0, 1fr);
		}
		/* Phones: each app as a block instead of a table row. */
		thead {
			display: none;
		}
		table,
		tbody,
		tr,
		td {
			display: block;
		}
		tr {
			padding: 10px 0;
			border-top: 1px solid var(--border);
		}
		td {
			padding: 2px 0;
			border: 0;
		}
		.addresses > span {
			white-space: normal;
		}
		.purpose {
			min-width: 0;
		}
	}
</style>
