<script lang="ts">
	import '../app.css';
	import { page } from '$app/state';

	let { data, children } = $props();

	const links = $derived([
		{ href: '/', label: 'Log', active: page.url.pathname === '/' || page.url.pathname.startsWith('/entries/') },
		{ href: `/month/${data.today.slice(0, 7)}`, label: 'Month', active: page.url.pathname.startsWith('/month/') },
		{ href: `/year/${data.today.slice(0, 4)}`, label: 'Year', active: page.url.pathname.startsWith('/year/') }
	]);
</script>

{#if page.url.pathname === '/login'}
	{@render children()}
{:else}
	<header>
		<nav class="segmented" aria-label="Main">
			{#each links as link (link.href)}
				<a href={link.href} class:selected={link.active} aria-current={link.active ? 'page' : undefined}>{link.label}</a>
			{/each}
		</nav>
	</header>
	<main>
		{@render children()}
	</main>
{/if}

<style>
	header {
		position: sticky;
		top: 0;
		z-index: 10;
		padding: max(10px, env(safe-area-inset-top)) 14px 10px;
		background: rgba(7, 10, 18, 0.75);
		backdrop-filter: blur(20px);
		-webkit-backdrop-filter: blur(20px);
	}
	nav {
		max-width: 520px;
		margin: 0 auto;
	}
	main {
		max-width: 1100px;
		margin: 0 auto;
		padding: 8px 14px max(28px, env(safe-area-inset-bottom));
		display: grid;
		gap: 14px;
	}
</style>
