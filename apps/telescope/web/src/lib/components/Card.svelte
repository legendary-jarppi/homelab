<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		title,
		accessory,
		children
	}: { title?: string; accessory?: Snippet; children: Snippet } = $props();
</script>

<section class="card">
	{#if title || accessory}
		<header>
			{#if title}<h2>{title}</h2>{/if}
			{#if accessory}<div class="accessory">{@render accessory()}</div>{/if}
		</header>
	{/if}
	{@render children()}
</section>

<style>
	.card {
		height: 100%;
		display: flex;
		flex-direction: column;
		gap: 10px;
		padding: 15px 18px;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		backdrop-filter: blur(20px) saturate(140%);
		-webkit-backdrop-filter: blur(20px) saturate(140%);
		box-shadow: 0 1px 0 rgba(255, 255, 255, 0.04) inset, 0 20px 50px rgba(0, 0, 0, 0.25);
		min-width: 0;
	}
	header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
	}
	h2 {
		margin: 0;
		font-size: 13px;
		font-weight: 600;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--muted);
	}
	.accessory {
		font-size: 13px;
		color: var(--muted);
	}
</style>
