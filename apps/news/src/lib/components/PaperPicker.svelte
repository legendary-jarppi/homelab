<script lang="ts">
	import { useI18n } from '$lib/i18n';

	/** Switch between papers on the Papers pages; `current` is the slug being read. */
	let { papers, current }: { papers: { slug: string; name: string; hidden: boolean }[]; current?: string } = $props();
	const i = useI18n();
</script>

<nav class="picker" aria-label={i.t('nav.papers')}>
	<ul>
		{#each papers as p (p.slug)}
			<li>
				<a href="/papers/{p.slug}" class:hidden={p.hidden} aria-current={p.slug === current ? 'page' : undefined}>{p.name}</a>
			</li>
		{/each}
	</ul>
</nav>

<style>
	.picker ul {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		margin: 0 0 var(--space-5);
		padding: 0;
		list-style: none;
	}

	a {
		display: inline-flex;
		align-items: center;
		min-height: var(--touch);
		padding: 0 var(--space-4);
		border: var(--hairline);
		font-family: var(--font-ui);
		font-size: var(--step--1);
		font-weight: 600;
		color: var(--ink);
		text-decoration: none;
	}

	a:hover {
		border-color: var(--ink);
	}

	a[aria-current='page'] {
		border-color: var(--ink);
		background: var(--ink);
		color: var(--paper);
	}

	a.hidden {
		color: var(--ink-3);
		text-decoration: line-through;
	}
</style>
