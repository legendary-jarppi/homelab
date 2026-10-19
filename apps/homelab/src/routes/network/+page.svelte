<script lang="ts">
	import Card from '$lib/components/Card.svelte';
	import Diagram from '$lib/components/Diagram.svelte';
	import Markdown from '$lib/components/Markdown.svelte';
	import { NETWORK } from '$lib/architecture';

	/** The path through the network as a diagram, then the address plan, DNS and ports from the docs. */
	let { data } = $props();
</script>

<svelte:head><title>Network · Homelab</title></svelte:head>

<Diagram diagram={NETWORK} links={data.links} />

<h2 class="section">Reference</h2>
<div class="reference">
	{#each data.reference as r (r.path)}
		<Card>
			<p class="source">From <a href={r.href}>{r.path}</a></p>
			<Markdown html={r.html} />
		</Card>
	{/each}
</div>

<style>
	.section {
		margin: 14px 0 0;
		font-size: 13px;
		font-weight: 600;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--muted);
	}
	.reference {
		display: grid;
		gap: 12px;
	}
	.source {
		margin: 0;
		font-size: 12px;
		color: var(--muted);
	}
	.source a {
		color: var(--down);
		text-decoration: none;
	}
</style>
