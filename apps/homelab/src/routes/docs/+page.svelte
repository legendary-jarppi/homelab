<script lang="ts">
	import Card from '$lib/components/Card.svelte';

	/** Index of every README and doc in the repository, as committed when this site was built. */
	let { data } = $props();
</script>

<svelte:head><title>Docs · Homelab</title></svelte:head>

<div class="index">
	{#each data.sections as s (s.name)}
		<div class:wide={s.docs.length > 6}>
			<Card title={s.name}>
				<ul>
					{#each s.docs as d (d.path)}
						<li>
							<a href={d.href}>{d.title}</a>
							<span class="path">{d.path}</span>
						</li>
					{/each}
				</ul>
			</Card>
		</div>
	{/each}
</div>

<style>
	.index {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
		gap: 12px;
		align-items: start;
	}
	.wide {
		grid-column: 1 / -1;
	}
	ul {
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.wide ul {
		columns: 300px;
		column-gap: 24px;
	}
	li + li {
		margin-top: 8px;
	}
	li {
		display: flex;
		flex-direction: column;
		break-inside: avoid;
	}
	.wide li {
		margin: 0 0 8px;
	}
	a {
		color: var(--text);
		font-weight: 600;
		text-decoration: none;
	}
	a:hover {
		color: var(--down);
	}
	.path {
		font-size: 12px;
		color: var(--faint);
		font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
	}
</style>
