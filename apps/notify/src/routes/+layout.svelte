<script lang="ts">
	import '../app.css';

	let { children } = $props();
</script>

<header>
	<div class="inner">
		<a class="brand" href="/">
			<span class="mark" aria-hidden="true">
				<svg viewBox="0 0 24 24"><path d="M12 22a2.5 2.5 0 0 0 2.45-2h-4.9A2.5 2.5 0 0 0 12 22zm7-6V11a7 7 0 0 0-5.5-6.84V3.5a1.5 1.5 0 0 0-3 0v.66A7 7 0 0 0 5 11v5l-2 2v1h18v-1z" /></svg>
			</span>
			Notify
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
		max-width: 720px;
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
		background: linear-gradient(135deg, #fbbf24, #f472b6);
	}
	.mark svg {
		width: 18px;
		height: 18px;
		fill: #fff;
	}
	main {
		max-width: 720px;
		margin: 0 auto;
		padding: 16px 14px max(28px, env(safe-area-inset-bottom));
		display: grid;
		gap: 16px;
	}
</style>
