<script lang="ts">
	import { untrack } from 'svelte';
	import Diagram from '$lib/components/Diagram.svelte';
	import { COMPONENTS } from '$lib/architecture';
	import { liveStatus } from '$lib/live.svelte';

	/** Every namespace and outside component with live pod status (refreshed every 30 s). */
	let { data } = $props();
	const live = liveStatus(untrack(() => data.status));
</script>

<svelte:head><title>Components · Homelab</title></svelte:head>

{#if live.failed}<p class="warn">Live pod status unavailable (Prometheus); showing the structure only.</p>{/if}
<Diagram diagram={COMPONENTS} data={live.data} links={data.links} />

<style>
	.warn {
		margin: 0;
		font-size: 13px;
		color: var(--warn);
	}
</style>
