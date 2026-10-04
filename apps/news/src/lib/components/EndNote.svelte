<script lang="ts">
	import type { Snippet } from 'svelte';

	let { children }: { children: Snippet } = $props();
</script>

<div class="end">
	<span class="ornament" aria-hidden="true">❧</span>
	<p>{@render children()}</p>
</div>

<style>
	.end {
		margin: var(--space-7) auto var(--space-5);
		max-width: 36rem;
		text-align: center;
	}

	.ornament {
		display: block;
		margin-bottom: var(--space-3);
		color: var(--ink-3);
		font-size: var(--step-1);
	}

	p {
		font-style: italic;
		color: var(--ink-2);
		font-size: var(--step-0);
		text-wrap: balance;
	}
</style>
