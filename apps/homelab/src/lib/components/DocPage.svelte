<script lang="ts">
	import Card from './Card.svelte';
	import Markdown from './Markdown.svelte';

	/** A whole markdown file from the repository, with where it lives. */
	let { path, html, title }: { path: string; html: string; title: string } = $props();
</script>

<svelte:head><title>{title} · Homelab</title></svelte:head>

<article>
	<Card>
		<p class="source"><a href="/docs">Docs</a> / {path}</p>
		<Markdown {html} />
	</Card>
</article>

<style>
	article {
		max-width: 1100px;
		width: 100%;
	}
	.source {
		margin: 0;
		font-size: 12px;
		color: var(--muted);
		font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
	}
	.source a {
		color: var(--down);
		text-decoration: none;
		font-family: var(--font);
	}
	article :global(.card) {
		padding: 18px 26px 22px;
	}
	@media (max-width: 640px) {
		article :global(.card) {
			padding: 14px 16px 18px;
		}
	}
</style>
