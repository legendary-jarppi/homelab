<script lang="ts">
	import { tick } from 'svelte';
	import { EDGE_KINDS, nodeWorkloads, unmodelled, workloadsStatus, type ArchitectureData, type Diagram, type DiagramEdge, type DiagramNode, type Status } from '$lib/architecture';
	import { formatAgo, formatBytes } from '$lib/format';

	/**
	 * A diagram from $lib/architecture: groups laid out by CSS grid areas, components as buttons, and
	 * connections drawn over them from the components' measured positions. Tap a component to
	 * highlight its connections and see what it does; `data` adds live pod status (Components),
	 * `links` the docs page and, for planned devices, the plan of each component (by node id).
	 * Planned devices and their connections are dashed.
	 */
	let { diagram, data = null, links = {} }: { diagram: Diagram; data?: ArchitectureData | null; links?: Record<string, { docs?: string; plan?: string }> } = $props();

	let selected = $state<string | null>(null);
	let hovered = $state<string | null>(null);
	const focus = $derived(selected ?? hovered);

	const byId = $derived(new Map(diagram.groups.flatMap((g) => g.nodes.map((n) => [n.id, { node: n, group: g }] as const))));
	/** The focused component and everything it connects to. */
	const linked = $derived.by(() => {
		if (!focus) return null;
		const ids = new Set([focus]);
		for (const e of diagram.edges) {
			if (e.from === focus) ids.add(e.to);
			if (e.to === focus) ids.add(e.from);
		}
		return ids;
	});
	const missing = $derived(unmodelled(diagram, data));

	const cols = (rows: string[]) => rows[0].trim().split(/\s+/).length;
	const areas = (rows: string[]) => rows.map((r) => `"${r}"`).join(' ');

	const status = (node: DiagramNode): Status | null => (node.workloads && data ? workloadsStatus(nodeWorkloads(node, data), Date.now()) : null);
	const planned = (id: string) => byId.get(id)?.node.device?.planned !== undefined;

	// Connection lines, measured from the rendered components.
	let container: HTMLDivElement;
	const els: Record<string, HTMLElement> = {};
	type Line = DiagramEdge & { key: string; d: string; mx: number; my: number };
	let lines = $state<Line[]>([]);
	let size = $state({ w: 0, h: 0 });

	async function layout() {
		await tick();
		if (!container) return;
		const c = container.getBoundingClientRect();
		const rect = (id: string) => {
			const r = els[id]?.getBoundingClientRect();
			return r && { l: r.left - c.left, r: r.right - c.left, t: r.top - c.top, b: r.bottom - c.top, cx: r.left - c.left + r.width / 2, cy: r.top - c.top + r.height / 2 };
		};
		const next: Line[] = [];
		for (const e of diagram.edges) {
			const a = rect(e.from);
			const b = rect(e.to);
			if (!a || !b) continue;
			// Leave from the side facing the target; curve with controls along that axis.
			let p0: [number, number], p3: [number, number], c1: [number, number], c2: [number, number];
			if (b.l >= a.r + 6 || a.l >= b.r + 6) {
				const right = b.l >= a.r + 6;
				p0 = [right ? a.r : a.l, a.cy];
				p3 = [right ? b.l : b.r, b.cy];
				const k = Math.max(30, Math.abs(p3[0] - p0[0]) * 0.45);
				c1 = [p0[0] + (right ? k : -k), p0[1]];
				c2 = [p3[0] - (right ? k : -k), p3[1]];
			} else if (b.t >= a.b || a.t >= b.b) {
				const down = b.t >= a.b;
				p0 = [a.cx, down ? a.b : a.t];
				p3 = [b.cx, down ? b.t : b.b];
				const k = Math.max(20, Math.abs(p3[1] - p0[1]) * 0.45);
				c1 = [p0[0], p0[1] + (down ? k : -k)];
				c2 = [p3[0], p3[1] - (down ? k : -k)];
			} else {
				// Overlapping boxes (same column): loop out to the right.
				p0 = [a.r, a.cy];
				p3 = [b.r, b.cy];
				c1 = [a.r + 40, a.cy];
				c2 = [b.r + 40, b.cy];
			}
			next.push({
				...e,
				key: `${e.from}>${e.to}`,
				d: `M${p0[0]},${p0[1]} C${c1[0]},${c1[1]} ${c2[0]},${c2[1]} ${p3[0]},${p3[1]}`,
				mx: (p0[0] + 3 * c1[0] + 3 * c2[0] + p3[0]) / 8,
				my: (p0[1] + 3 * c1[1] + 3 * c2[1] + p3[1]) / 8
			});
		}
		lines = next;
		size = { w: container.scrollWidth, h: container.scrollHeight };
	}

	$effect(() => {
		void diagram;
		void data;
		const observer = new ResizeObserver(() => layout());
		observer.observe(container);
		layout();
		return () => observer.disconnect();
	});

	const current = $derived(selected ? byId.get(selected) : undefined);
	const outgoing = $derived(selected ? diagram.edges.filter((e) => e.from === selected) : []);
	const incoming = $derived(selected ? diagram.edges.filter((e) => e.to === selected) : []);
	const pods = $derived(current ? nodeWorkloads(current.node, data).flatMap(([key, w]) => w.pods.map((p) => ({ ...p, workload: key, kind: w.kind }))) : []);
	const cronjob = $derived(current ? nodeWorkloads(current.node, data).find(([, w]) => w.kind === 'CronJob')?.[1] : undefined);
	const labelOf = (id: string) => byId.get(id)?.node.label ?? id;
	const groupOf = (id: string) => byId.get(id)?.group.label ?? '';
</script>

<div class="wrap">
	<div class="canvas">
		<div
			class="diagram"
			bind:this={container}
			style:--areas-wide={areas(diagram.areas.wide)}
			style:--cols-wide={cols(diagram.areas.wide)}
			style:--areas-narrow={areas(diagram.areas.narrow)}
			style:--cols-narrow={cols(diagram.areas.narrow)}
		>
			{#each diagram.groups as g (g.id)}
				<section class="group {g.kind}" style:grid-area={g.id}>
					<header>
						<span class="name">{g.label}</span>
						{#if g.sub}<span class="gsub">{g.sub}</span>{/if}
					</header>
					<div class="nodes" class:row={g.row}>
						{#each g.nodes as n (n.id)}
							{@const s = status(n)}
							<button
								class="node"
								class:selected={selected === n.id}
								class:dim={linked !== null && !linked.has(n.id)}
								class:planned={planned(n.id)}
								bind:this={els[n.id]}
								onclick={() => (selected = selected === n.id ? null : n.id)}
								onpointerenter={(e) => e.pointerType === 'mouse' && (hovered = n.id)}
								onpointerleave={() => (hovered = null)}
							>
								<span class="title">
									{#if s}<i class="dot {s.tone}"></i>{/if}
									{n.label}
								</span>
								{#if n.sub}<span class="sub">{n.sub}</span>{/if}
								{#if s}<span class="live num {s.tone}">{s.text}</span>{/if}
							</button>
						{/each}
					</div>
				</section>
			{/each}
			<svg class="lines" width={size.w} height={size.h} aria-hidden="true">
				<defs>
					{#each EDGE_KINDS as k (k.kind)}
						<marker id="arrow-{k.kind}" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
							<path d="M0,0 L8,4 L0,8 z" class="head {k.kind}" />
						</marker>
					{/each}
				</defs>
				{#each lines as l (l.key)}
					{@const on = focus !== null && (l.from === focus || l.to === focus)}
					<path d={l.d} class="edge {l.kind}" class:on class:off={focus !== null && !on} class:planned={planned(l.from) || planned(l.to)} marker-end="url(#arrow-{l.kind})" />
				{/each}
				{#each lines as l (l.key)}
					{#if focus !== null && (l.from === focus || l.to === focus)}
						<text x={l.mx} y={l.my} class="label">{l.label}</text>
					{/if}
				{/each}
			</svg>
		</div>
		{#if missing.length > 0}
			<p class="missing">Running but not in this diagram yet: {missing.join(', ')}</p>
		{/if}
	</div>

	<aside class="panel">
		{#if current}
			<div class="head">
				<span class="ns">{current.group.kind === 'namespace' ? `namespace ${current.group.label}` : current.group.label}</span>
				<button class="close" onclick={() => (selected = null)} aria-label="Close">
					<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18" /></svg>
				</button>
			</div>
			<h3>{current.node.label}</h3>
			{#if current.node.sub}<p class="muted">{current.node.sub}</p>{/if}
			<p>{current.node.info}</p>
			{#if current.node.href && current.node.href !== '/'}
				<a href={current.node.href} target="_blank" rel="noopener">Open {current.node.href.replace(/^https?:\/\//, '')} ↗</a>
			{/if}
			{#if links[current.node.id]?.plan}
				<a href={links[current.node.id].plan}>Planned: read the plan →</a>
			{/if}
			{#if links[current.node.id]?.docs}
				<a href={links[current.node.id].docs}>Docs →</a>
			{/if}
			{#if outgoing.length > 0}
				<h4>Talks to</h4>
				<ul class="links">
					{#each outgoing as e (e.to)}
						<li><button onclick={() => (selected = e.to)}><i class="swatch {e.kind}"></i><b>{labelOf(e.to)}</b> <span class="muted">{groupOf(e.to)}</span><span class="why">{e.label}</span></button></li>
					{/each}
				</ul>
			{/if}
			{#if incoming.length > 0}
				<h4>Used by</h4>
				<ul class="links">
					{#each incoming as e (e.from)}
						<li><button onclick={() => (selected = e.from)}><i class="swatch {e.kind}"></i><b>{labelOf(e.from)}</b> <span class="muted">{groupOf(e.from)}</span><span class="why">{e.label}</span></button></li>
					{/each}
				</ul>
			{/if}
			{#if cronjob}
				<h4>Runs</h4>
				<p class="num">{cronjob.lastSuccess ? `Last success ${formatAgo(cronjob.lastSuccess / 1000)}` : 'No successful run yet'}{pods.length > 0 ? ' · running now' : ''}</p>
			{/if}
			{#if pods.length > 0}
				<h4>Pods</h4>
				<table class="num">
					<thead><tr><th>Pod</th><th>CPU</th><th>Memory</th><th>Restarts 24 h</th></tr></thead>
					<tbody>
						{#each pods as p (p.name)}
							<tr>
								<td><i class="dot {p.ready ? 'ok' : p.phase === 'Pending' ? 'warn' : 'bad'}"></i>{p.name}</td>
								<td>{p.cpu === null ? '–' : `${(p.cpu * 100).toFixed(p.cpu < 0.1 ? 1 : 0)} %`}</td>
								<td>{formatBytes(p.memory)}</td>
								<td class:warnText={p.restarts24h > 0}>{p.restarts24h}</td>
							</tr>
						{/each}
					</tbody>
				</table>
				<p class="hint muted">CPU: share of one core, 5 min average.</p>
			{/if}
		{:else}
			<h3>How it fits together</h3>
			<p class="muted">Tap a component to see what it does, what it talks to and its pods. Lines point from the side that opens the connection.</p>
			<ul class="legend">
				{#each EDGE_KINDS as k (k.kind)}
					<li><i class="swatch {k.kind}"></i>{k.label}</li>
				{/each}
			</ul>
			{#if data}
				<ul class="legend">
					<li><i class="dot ok"></i>All pods ready</li>
					<li><i class="dot warn"></i>Restarted in 24 h, or not all ready</li>
					<li><i class="dot bad"></i>Not running</li>
					{#if diagram.groups.some((g) => g.nodes.some((n) => n.device?.planned))}<li><i class="planned-mark"></i>Planned, not there yet</li>{/if}
				</ul>
			{/if}
		{/if}
	</aside>
</div>

<style>
	.wrap {
		display: grid;
		gap: 12px;
		min-height: 0;
	}
	.canvas {
		min-width: 0;
		overflow-x: auto;
	}
	.diagram {
		position: relative;
		display: grid;
		gap: 22px 26px;
		align-items: start;
		grid-template-columns: repeat(var(--cols-narrow), minmax(0, 1fr));
		grid-template-areas: var(--areas-narrow);
		padding: 4px 40px 4px 4px;
		min-width: 340px;
	}
	.group {
		display: flex;
		flex-direction: column;
		gap: 7px;
		padding: 9px 10px 10px;
		border: 1px solid var(--border);
		border-radius: 14px;
		background: var(--surface);
		min-width: 0;
	}
	.group.outside {
		border-style: dashed;
		background: transparent;
	}
	.group.zone {
		background: rgba(56, 189, 248, 0.035);
	}
	header {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 2px 8px;
	}
	.name {
		font-size: 11px;
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--muted);
	}
	.gsub {
		font-size: 11px;
		color: var(--faint);
	}
	.nodes {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.nodes.row {
		flex-direction: row;
		flex-wrap: wrap;
		gap: 6px 26px;
	}
	.nodes.row > .node {
		flex: 1 1 150px;
	}
	.node {
		position: relative;
		z-index: 2;
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 1px;
		padding: 6px 9px;
		text-align: left;
		border: 1px solid var(--border);
		border-radius: 9px;
		background: #111726;
		color: var(--text);
		cursor: pointer;
		transition: opacity 0.15s, border-color 0.15s;
		min-width: 0;
	}
	.node.selected {
		border-color: var(--down);
		box-shadow: 0 0 0 1px var(--down);
	}
	.node.dim {
		opacity: 0.3;
	}
	.node.planned {
		border-style: dashed;
		background: transparent;
		color: var(--muted);
	}
	.title {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 13px;
		font-weight: 600;
		max-width: 100%;
	}
	.sub {
		font-size: 11px;
		line-height: 1.3;
		color: var(--muted);
		max-width: 100%;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}
	.live {
		font-size: 11px;
		color: var(--muted);
		max-width: 100%;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.live.warn {
		color: var(--warn);
	}
	.live.bad {
		color: var(--bad);
	}
	.dot {
		flex: none;
		display: inline-block;
		width: 7px;
		height: 7px;
		border-radius: 50%;
		margin-right: 6px;
	}
	.title .dot {
		margin-right: 0;
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

	.lines {
		position: absolute;
		inset: 0;
		z-index: 1;
		pointer-events: none;
		overflow: visible;
	}
	.edge {
		fill: none;
		stroke-width: 1.4;
		opacity: 0.4;
		transition: opacity 0.15s;
	}
	.edge.on {
		stroke-width: 2.2;
		opacity: 1;
	}
	.edge.off {
		opacity: 0.06;
	}
	.edge.control {
		stroke-dasharray: 4 3;
	}
	.edge.planned {
		stroke-dasharray: 2 4;
	}
	.planned-mark {
		flex: none;
		width: 16px;
		height: 10px;
		border: 1px dashed var(--muted);
		border-radius: 3px;
	}
	.label {
		font-size: 11px;
		font-weight: 600;
		fill: var(--text);
		text-anchor: middle;
		dominant-baseline: middle;
		paint-order: stroke;
		stroke: var(--bg);
		stroke-width: 4px;
		stroke-linejoin: round;
	}
	/* Connection colours (lines, arrowheads, legend swatches). */
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
	.edge {
		stroke: var(--c);
	}
	.head {
		fill: var(--c);
	}
	.swatch {
		flex: none;
		display: inline-block;
		width: 16px;
		height: 3px;
		border-radius: 2px;
		background: var(--c);
	}
	.missing {
		margin: 10px 4px 0;
		font-size: 12px;
		color: var(--warn);
	}

	/* Narrow screens: the panel follows below the diagram but stays pinned to the bottom of the screen
	   while scrolling, so a tapped component's details are visible at once. */
	.panel {
		position: sticky;
		bottom: max(10px, env(safe-area-inset-bottom));
		z-index: 3;
		max-height: 45dvh;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 14px 16px;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: rgba(13, 18, 32, 0.94);
		backdrop-filter: blur(16px);
		-webkit-backdrop-filter: blur(16px);
		box-shadow: 0 -10px 40px rgba(0, 0, 0, 0.45);
		font-size: 13px;
		line-height: 1.45;
		min-width: 0;
	}
	.panel p {
		margin: 0;
	}
	.panel .head {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}
	.ns {
		font-size: 11px;
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--muted);
	}
	.close {
		width: 30px;
		height: 30px;
		display: grid;
		place-items: center;
		border: 1px solid var(--border);
		border-radius: 50%;
		background: var(--surface-strong);
		cursor: pointer;
	}
	.close svg {
		width: 14px;
		height: 14px;
		fill: none;
		stroke: currentColor;
		stroke-width: 2;
		stroke-linecap: round;
	}
	h3 {
		margin: 0;
		font-size: 18px;
	}
	h4 {
		margin: 6px 0 0;
		font-size: 11px;
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--muted);
	}
	a {
		color: var(--down);
		text-decoration: none;
		font-weight: 600;
	}
	.links,
	.legend {
		margin: 0;
		padding: 0;
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.links button {
		display: grid;
		grid-template-columns: 16px auto 1fr;
		align-items: center;
		gap: 2px 8px;
		width: 100%;
		padding: 6px 8px;
		text-align: left;
		font: inherit;
		color: inherit;
		border: 1px solid var(--border);
		border-radius: 8px;
		background: var(--surface-strong);
		cursor: pointer;
	}
	.links .muted {
		font-size: 11px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.why {
		grid-column: 2 / -1;
		font-size: 12px;
		color: var(--muted);
	}
	.legend li {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.legend .dot {
		margin-right: 0;
	}
	table {
		width: 100%;
		border-collapse: collapse;
		font-size: 12px;
	}
	th {
		text-align: left;
		font-weight: 600;
		color: var(--muted);
		padding: 0 6px 4px 0;
	}
	td {
		padding: 3px 6px 3px 0;
		border-top: 1px solid var(--border);
		white-space: nowrap;
	}
	td:first-child {
		max-width: 150px;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.warnText {
		color: var(--warn);
	}
	.hint {
		font-size: 11px;
	}

	/* iPad landscape and laptops: the diagram's wide layout, details beside it. */
	@media (min-width: 1000px) {
		.wrap {
			grid-template-columns: minmax(0, 1fr) 270px;
			align-items: start;
		}
		.diagram {
			grid-template-columns: repeat(var(--cols-wide), minmax(0, 1fr));
			grid-template-areas: var(--areas-wide);
		}
		.panel {
			top: 0;
			bottom: auto;
			max-height: calc(100dvh - 190px);
			background: var(--surface);
			box-shadow: none;
		}
	}
</style>
