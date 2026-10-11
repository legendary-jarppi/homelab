<script lang="ts">
	import PageTitle from '$lib/components/PageTitle.svelte';
	import { fullDate, when } from '$lib/components/format';

	let { data } = $props();
</script>

<svelte:head>
	<title>Papers · Shilly Shally News</title>
</svelte:head>

<PageTitle title="Papers" lede="One paper at a time: everything from it that passes your settings, newest first." />

<ul class="papers">
	{#each data.papers as p (p.slug)}
		<li>
			<h2 class="hed hed-3"><a href="/papers/{p.slug}">{p.name}</a></h2>
			{#if p.hidden}
				<p class="note">Hidden in your <a href="/settings#outlets">settings</a>.</p>
			{:else if p.newest}
				<p class="newest">
					<time datetime={p.newest.publishedAt.toISOString()} title={fullDate(p.newest.publishedAt)}>{when(p.newest.publishedAt)}</time>
					<a href="/article/{p.newest.id}" lang={p.newest.language ?? undefined}>{p.newest.headline}</a>
				</p>
			{:else}
				<p class="note">Nothing from this paper just now.</p>
			{/if}
		</li>
	{/each}
</ul>

<style>
	.papers {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(17rem, 1fr));
		gap: 0 var(--gutter);
		margin: 0;
		padding: 0;
		list-style: none;
	}

	li {
		display: grid;
		gap: var(--space-2);
		align-content: start;
		padding: var(--space-4) 0 var(--space-5);
		border-top: var(--hairline);
	}

	h2 a {
		text-decoration: none;
	}

	.newest {
		display: grid;
		gap: var(--space-1);
	}

	.newest a {
		color: var(--ink);
	}

	time,
	.note {
		font-family: var(--font-ui);
		font-size: var(--step--1);
		color: var(--ink-2);
	}
</style>
