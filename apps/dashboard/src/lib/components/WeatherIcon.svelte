<script lang="ts">
	import type { WeatherKind } from '$lib/weather';

	let { kind, day = true, size = 40 }: { kind: WeatherKind; day?: boolean; size?: number } = $props();

	const CLOUD = 'M7 18.5h10.5a4 4 0 0 0 .4-8 5.5 5.5 0 0 0-10.6 1.2A3.4 3.4 0 0 0 7 18.5z';
	const SMALL_CLOUD = 'M9 19.5h9a3.4 3.4 0 0 0 .35-6.8A4.7 4.7 0 0 0 9.3 13.7 2.9 2.9 0 0 0 9 19.5z';
</script>

<svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
	{#if kind === 'clear'}
		{#if day}
			<circle cx="12" cy="12" r="4.5" class="sun" />
			{#each [0, 45, 90, 135, 180, 225, 270, 315] as a (a)}
				<line x1="12" y1="2.6" x2="12" y2="4.6" class="ray" transform="rotate({a} 12 12)" />
			{/each}
		{:else}
			<path d="M15.5 3.5a8 8 0 1 0 5 13.8A7 7 0 0 1 15.5 3.5z" class="moon" />
		{/if}
	{:else if kind === 'partly'}
		{#if day}
			<circle cx="8.5" cy="8.5" r="3.6" class="sun" />
			{#each [0, 60, 120, 180, 240, 300] as a (a)}
				<line x1="8.5" y1="2.3" x2="8.5" y2="3.6" class="ray" transform="rotate({a} 8.5 8.5)" />
			{/each}
		{:else}
			<path d="M10.5 3a5.5 5.5 0 1 0 3.5 9.5A4.8 4.8 0 0 1 10.5 3z" class="moon" />
		{/if}
		<path d={SMALL_CLOUD} class="cloud" />
	{:else}
		<path d={CLOUD} class={kind === 'thunder' ? 'cloud dark' : 'cloud'} />
		{#if kind === 'fog'}
			<line x1="5" y1="21" x2="19" y2="21" class="fogline" />
			<line x1="7" y1="23" x2="17" y2="23" class="fogline" />
		{:else if kind === 'drizzle'}
			{#each [8, 12, 16] as x (x)}<line x1={x} y1="20.5" x2={x - 0.6} y2="22" class="drop" />{/each}
		{:else if kind === 'rain'}
			{#each [8, 12, 16] as x (x)}<line x1={x} y1="20.2" x2={x - 1.2} y2="23" class="drop" />{/each}
		{:else if kind === 'snow'}
			{#each [8, 12, 16] as x (x)}<circle cx={x} cy="21.6" r="1" class="flake" />{/each}
		{:else if kind === 'thunder'}
			<path d="M12.5 17.5 10 21.5h2.6l-1.3 3.5 4-5h-2.7l1.4-2.5z" class="bolt" />
		{/if}
	{/if}
</svg>

<style>
	svg {
		overflow: visible;
		flex: none;
	}
	.sun {
		fill: #fbbf24;
		filter: drop-shadow(0 0 4px rgba(251, 191, 36, 0.6));
	}
	.ray {
		stroke: #fbbf24;
		stroke-width: 1.6;
		stroke-linecap: round;
	}
	.moon {
		fill: #e2e8f0;
		filter: drop-shadow(0 0 4px rgba(226, 232, 240, 0.35));
	}
	.cloud {
		fill: #cbd5e1;
	}
	.cloud.dark {
		fill: #94a3b8;
	}
	.drop {
		stroke: #38bdf8;
		stroke-width: 1.5;
		stroke-linecap: round;
	}
	.flake {
		fill: #e0f2fe;
	}
	.fogline {
		stroke: #94a3b8;
		stroke-width: 1.4;
		stroke-linecap: round;
	}
	.bolt {
		fill: #fbbf24;
	}
</style>
