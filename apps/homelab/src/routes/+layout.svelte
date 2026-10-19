<script lang="ts">
	import '../app.css';
	import { page } from '$app/state';

	let { children } = $props();

	const TABS = [
		{ href: '/', label: 'Overview' },
		{ href: '/components', label: 'Components' },
		{ href: '/network', label: 'Network' },
		{ href: '/devices', label: 'Devices' },
		{ href: '/plans', label: 'Plans' },
		{ href: '/shopping', label: 'Shopping list' },
		{ href: '/docs', label: 'Docs' }
	];
	const active = (href: string) => (href === '/' ? page.url.pathname === '/' : page.url.pathname === href || page.url.pathname.startsWith(`${href}/`));
</script>

<div class="page">
	<header>
		<a class="brand" href="/">
			<svg viewBox="0 0 32 32" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="2"><rect x="7" y="7" width="18" height="5" rx="1.5" /><rect x="7" y="13.5" width="18" height="5" rx="1.5" /><rect x="7" y="20" width="18" height="5" rx="1.5" /></g></svg>
			<span>Homelab</span>
		</a>
		<nav class="tabs" aria-label="Pages">
			{#each TABS as t (t.href)}
				<a href={t.href} class:active={active(t.href)} aria-current={active(t.href) ? 'page' : undefined}>{t.label}</a>
			{/each}
		</nav>
	</header>
	{@render children()}
</div>

<style>
	.page {
		max-width: 1600px;
		margin: 0 auto;
		display: flex;
		flex-direction: column;
		gap: 14px;
		padding: max(18px, env(safe-area-inset-top)) max(18px, env(safe-area-inset-right)) max(18px, env(safe-area-inset-bottom))
			max(18px, env(safe-area-inset-left));
	}
	header {
		display: flex;
		align-items: center;
		gap: 10px 18px;
		flex-wrap: wrap;
	}
	.brand {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		font-size: 20px;
		font-weight: 700;
		letter-spacing: -0.01em;
		color: var(--text);
		text-decoration: none;
	}
	.brand svg {
		width: 26px;
		height: 26px;
		color: var(--down);
	}
	.tabs {
		display: flex;
		padding: 3px;
		border-radius: 999px;
		background: var(--surface);
		border: 1px solid var(--border);
		max-width: 100%;
		overflow-x: auto;
		scrollbar-width: none;
	}
	.tabs a {
		flex: none;
		padding: 7px 14px;
		font-size: 13px;
		font-weight: 600;
		border-radius: 999px;
		color: var(--muted);
		text-decoration: none;
		white-space: nowrap;
	}
	.tabs a.active {
		background: rgba(255, 255, 255, 0.14);
		color: var(--text);
	}
	/* Phones: the tabs get their own row and scroll sideways. */
	@media (max-width: 640px) {
		.page {
			padding-left: max(14px, env(safe-area-inset-left));
			padding-right: max(14px, env(safe-area-inset-right));
		}
		.tabs {
			flex-basis: 100%;
			border-radius: 16px;
		}
		.tabs a {
			padding: 7px 11px;
		}
	}
</style>
