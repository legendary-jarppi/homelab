<script lang="ts">
	import { page } from '$app/state';
</script>

<svelte:head>
	<title>Not in the paper · Shilly Shally News</title>
</svelte:head>

<section class="error">
	{#if page.status === 404}
		<h1 class="hed hed-4">This page isn’t in the paper.</h1>
		<p>It may have moved, or the link may be mistyped.</p>
	{:else}
		<h1 class="hed hed-4">The press has jammed.</h1>
		<p>Something went wrong on our side. Please try again in a moment.</p>
	{/if}
	<p><a class="button" href="/">Go to the front page</a></p>
</section>

<style>
	.error {
		display: grid;
		gap: var(--space-4);
		justify-items: start;
		max-width: 36rem;
		margin: var(--space-8) auto;
	}

	.error p:not(:has(.button)) {
		color: var(--ink-2);
		font-style: italic;
	}
</style>
