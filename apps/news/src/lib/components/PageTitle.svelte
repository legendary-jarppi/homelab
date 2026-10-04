<script lang="ts">
	let { title, kicker, lede }: { title: string; kicker?: string; lede?: string } = $props();
</script>

<header class="page-title">
	{#if kicker}<p class="kicker">{kicker}</p>{/if}
	<h1 class="hed hed-5">{title}</h1>
	{#if lede}<p class="lede">{lede}</p>{/if}
</header>

<style>
	.page-title {
		margin: var(--space-6) 0 var(--space-5);
	}

	.lede {
		margin-top: var(--space-2);
		font-style: italic;
		color: var(--ink-2);
	}
</style>
