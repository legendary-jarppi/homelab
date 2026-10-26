<script lang="ts">
	import { page } from '$app/state';

	/** R5: the analysis pages across sessions, under one tab. */
	let { children } = $props();

	const PAGES = [
		{ href: '/stats', label: 'Overview' },
		{ href: '/stats/forecasts', label: 'Forecasts' },
		{ href: '/stats/focus', label: 'Focus' },
		{ href: '/stats/mount', label: 'Mount' }
	];
	const active = (href: string) => (href === '/stats' ? page.url.pathname === '/stats' : page.url.pathname.startsWith(href));
</script>

<nav class="sub" aria-label="Stats pages">
	{#each PAGES as p (p.href)}
		<a href={p.href} class:active={active(p.href)} aria-current={active(p.href) ? 'page' : undefined}>{p.label}</a>
	{/each}
</nav>
{@render children()}

<style>
	.sub {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
	}
	.sub a {
		padding: 5px 12px;
		font-size: 13px;
		font-weight: 600;
		border-radius: 999px;
		border: 1px solid var(--border);
		color: var(--muted);
		text-decoration: none;
	}
	.sub a.active {
		background: var(--surface-strong);
		color: var(--text);
	}
</style>
