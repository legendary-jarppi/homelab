<script lang="ts">
	import '../app.css';
	import { page } from '$app/state';

	let { children } = $props();
</script>

<header>
	<div class="inner">
		<a class="brand" href="/" aria-current={page.url.pathname === '/' ? 'page' : undefined}>
			<span class="mark" aria-hidden="true">
				<svg viewBox="0 0 24 24"><path d="M4 6h2v2H4zm4 0h12v2H8zm-4 5h2v2H4zm4 0h12v2H8zm-4 5h2v2H4zm4 0h12v2H8z" /></svg>
			</span>
			Lists
		</a>
	</div>
</header>
<main>
	{@render children()}
</main>

<style>
	header {
		position: sticky;
		top: 0;
		z-index: 10;
		padding: max(10px, env(safe-area-inset-top)) 14px 10px;
		background: rgba(7, 10, 18, 0.75);
		backdrop-filter: blur(20px);
		-webkit-backdrop-filter: blur(20px);
		border-bottom: 1px solid var(--border);
	}
	.inner {
		max-width: 980px;
		margin: 0 auto;
	}
	.brand {
		display: inline-flex;
		align-items: center;
		gap: 10px;
		font-size: 19px;
		font-weight: 650;
		text-decoration: none;
	}
	.mark {
		width: 32px;
		height: 32px;
		display: grid;
		place-items: center;
		border-radius: 10px;
		background: linear-gradient(135deg, #38bdf8, #c084fc);
	}
	.mark svg {
		width: 18px;
		height: 18px;
		fill: #fff;
	}
	main {
		max-width: 980px;
		margin: 0 auto;
		padding: 16px 14px max(28px, env(safe-area-inset-bottom));
		display: grid;
		gap: 16px;
	}
</style>
