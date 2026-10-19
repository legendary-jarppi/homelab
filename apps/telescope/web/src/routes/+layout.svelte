<script lang="ts">
	import '../app.css';
	import { page } from '$app/state';
	import { red, type RedMode } from '$lib/red.svelte';

	let { data, children } = $props();

	const TABS = [
		{ href: '/', label: 'Live' },
		{ href: '/conditions', label: 'Conditions' },
		{ href: '/planner', label: 'Planner' },
		{ href: '/goals', label: 'Goals' },
		{ href: '/sessions', label: 'Sessions' },
		{ href: '/library', label: 'Library' },
		{ href: '/finals', label: 'Finals' }
	];
	const active = (href: string) => (href === '/' ? page.url.pathname === '/' : page.url.pathname === href || page.url.pathname.startsWith(`${href}/`));
	const MODES: { mode: RedMode; label: string; title: string }[] = [
		{ mode: 'off', label: 'Off', title: 'Normal colours' },
		{ mode: 'on', label: 'Red', title: 'Red night mode' },
		{ mode: 'auto', label: 'Auto', title: 'Red while the sun is below the horizon at the site' }
	];

	$effect(() => red.start(data.site));
	$effect(() => red.apply(red.active));
</script>

<!-- Luminance into the red channel only: images (stack, frames) in red night mode (app.css --image-filter). -->
<svg class="defs" aria-hidden="true">
	<filter id="red-only" color-interpolation-filters="sRGB">
		<feColorMatrix type="matrix" values="0.3 0.55 0.15 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" />
	</filter>
</svg>

<div class="page">
	<header>
		<a class="brand" href="/">
			<svg viewBox="0 0 32 32" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 17l17-7 2 5-17 7z" /><path d="M14 19l-4 8M16 18l4 9" /></g></svg>
			<span>Telescope</span>
		</a>
		<nav class="tabs" aria-label="Pages">
			{#each TABS as t (t.href)}
				<a href={t.href} class:active={active(t.href)} aria-current={active(t.href) ? 'page' : undefined}>{t.label}</a>
			{/each}
		</nav>
		<div class="redmode" role="group" aria-label="Red night mode">
			<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" fill="currentColor" /></svg>
			{#each MODES as m (m.mode)}
				<button class:on={red.mode === m.mode} title={m.title} aria-pressed={red.mode === m.mode} onclick={() => red.set(m.mode)}>{m.label}</button>
			{/each}
		</div>
	</header>
	{@render children()}
</div>

<style>
	.defs {
		position: absolute;
		width: 0;
		height: 0;
	}
	.page {
		max-width: 1600px;
		margin: 0 auto;
		display: flex;
		flex-direction: column;
		gap: 14px;
		padding: max(14px, env(safe-area-inset-top)) max(18px, env(safe-area-inset-right)) max(18px, env(safe-area-inset-bottom)) max(18px, env(safe-area-inset-left));
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
		color: var(--accent);
	}
	.tabs,
	.redmode {
		display: flex;
		padding: 3px;
		border-radius: 999px;
		background: var(--surface);
		border: 1px solid var(--border);
	}
	.tabs a,
	.redmode button {
		flex: none;
		padding: 7px 14px;
		font-size: 13px;
		font-weight: 600;
		border-radius: 999px;
		color: var(--muted);
		text-decoration: none;
		white-space: nowrap;
		border: 0;
		background: none;
		cursor: pointer;
	}
	.tabs a.active,
	.redmode button.on {
		background: var(--surface-strong);
		color: var(--text);
	}
	.redmode {
		margin-left: auto;
		align-items: center;
	}
	.redmode svg {
		width: 16px;
		height: 16px;
		margin: 0 4px 0 8px;
		color: var(--muted);
	}
	.redmode button {
		padding: 7px 10px;
	}
	@media (max-width: 640px) {
		.page {
			padding-left: max(12px, env(safe-area-inset-left));
			padding-right: max(12px, env(safe-area-inset-right));
		}
		/* Seven pages: two rows of four on a phone. */
		.tabs {
			order: 3;
			flex-basis: 100%;
			display: grid;
			grid-template-columns: repeat(4, 1fr);
			gap: 2px;
			border-radius: 16px;
		}
		.tabs a {
			padding: 8px 4px;
			text-align: center;
		}
	}
</style>
