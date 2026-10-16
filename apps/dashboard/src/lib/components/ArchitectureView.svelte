<script lang="ts">
	import Diagram from './Diagram.svelte';
	import { COMPONENTS, NETWORK, type ArchitectureData } from '$lib/architecture';

	/** Homelab tab's Components (live pod status, refreshed every 30 s while shown) or Network diagram. */
	let { view }: { view: 'components' | 'network' } = $props();

	let data = $state<ArchitectureData | null>(null);
	let failed = $state(false);

	$effect(() => {
		if (view !== 'components') return;
		let stopped = false;
		const load = async () => {
			try {
				const response = await fetch('/api/architecture', { cache: 'no-store' });
				if (!response.ok) throw new Error(String(response.status));
				const body: ArchitectureData = await response.json();
				if (!stopped) {
					data = body;
					failed = false;
				}
			} catch {
				if (!stopped) failed = true;
			}
		};
		load();
		const timer = setInterval(() => document.visibilityState === 'visible' && load(), 30_000);
		return () => {
			stopped = true;
			clearInterval(timer);
		};
	});
</script>

{#if view === 'components'}
	{#if failed}<p class="warn">Live pod status unavailable (Prometheus); showing the structure only.</p>{/if}
	<Diagram diagram={COMPONENTS} {data} />
{:else}
	<Diagram diagram={NETWORK} />
{/if}

<style>
	.warn {
		margin: 0 0 8px;
		font-size: 13px;
		color: var(--warn);
	}
</style>
