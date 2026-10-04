<script lang="ts">
	import { SECTIONS } from '$lib/core/taxonomy';

	let { path }: { path: string } = $props();

	const links = [{ href: '/', label: 'Front Page' }, ...SECTIONS.map((s) => ({ href: `/section/${s.key}`, label: s.label })), { href: '/latest', label: 'Latest' }];

	let sentinel: HTMLElement | undefined = $state();
	let stuck = $state(false);

	$effect(() => {
		if (!sentinel) return;
		const observer = new IntersectionObserver(([entry]) => (stuck = !entry.isIntersecting), { threshold: 0 });
		observer.observe(sentinel);
		return () => observer.disconnect();
	});
</script>

<div class="sentinel" bind:this={sentinel} aria-hidden="true"></div>
<nav class="sections no-print" class:stuck aria-label="Sections">
	<div class="page inner">
		<a class="mark" href="/" aria-hidden={!stuck} tabindex={stuck ? 0 : -1}>Shilly Shally News</a>
		<ul>
			{#each links as link (link.href)}
				<li>
					<a href={link.href} aria-current={path === link.href ? 'page' : undefined}>{link.label}</a>
				</li>
			{/each}
		</ul>
	</div>
</nav>

<style>
	.sentinel {
		height: 1px;
		margin-bottom: -1px;
	}

	.sections {
		position: sticky;
		top: 0;
		z-index: 5;
		background: var(--paper);
		border-bottom: 1px solid var(--ink);
	}

	.inner {
		display: flex;
		align-items: center;
		gap: var(--space-3);
	}

	.mark {
		display: none;
		flex: none;
		font-family: var(--font-masthead);
		font-size: var(--step-1);
		line-height: 1;
		text-decoration: none;
		white-space: nowrap;
		padding-right: var(--space-3);
		border-right: var(--hairline);
	}

	.stuck .mark {
		display: block;
	}

	ul {
		display: flex;
		flex: 1;
		justify-content: center;
		margin: 0;
		padding: 0;
		list-style: none;
		overflow-x: auto;
		scrollbar-width: none;
		overscroll-behavior-x: contain;
		-webkit-overflow-scrolling: touch;
	}

	ul::-webkit-scrollbar {
		display: none;
	}

	.stuck ul {
		justify-content: flex-start;
	}

	li {
		flex: none;
		display: flex;
		align-items: center;
	}

	li + li::before {
		content: '';
		width: 1px;
		height: 1em;
		background: var(--rule);
	}

	li a {
		display: flex;
		align-items: center;
		min-height: var(--touch);
		padding: 0 var(--space-3);
		font-family: var(--font-ui);
		font-size: var(--step--1);
		font-weight: 500;
		font-variant-caps: all-small-caps;
		letter-spacing: 0.1em;
		color: var(--ink);
		text-decoration: none;
		white-space: nowrap;
	}

	li a:hover {
		text-decoration: underline;
		text-decoration-color: var(--accent);
	}

	li a[aria-current='page'] {
		color: var(--accent);
		font-weight: 700;
	}

	@media (max-width: 64rem) {
		ul {
			justify-content: flex-start;
		}
	}

	@media (max-width: 40rem) {
		.stuck .mark {
			display: none;
		}

		li a {
			padding: 0 var(--space-2);
		}
	}
</style>
