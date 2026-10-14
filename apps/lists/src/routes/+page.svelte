<script lang="ts">
	import ItemRow from '$lib/components/ItemRow.svelte';

	let { data } = $props();
</script>

<svelte:head><title>Lists</title></svelte:head>

<div class="top">
	<h1>Lists</h1>
	<a class="button primary" href="/lists/new">New list</a>
</div>

{#if data.lists.length === 0}
	<p class="muted">No lists yet. Create one to start collecting.</p>
{/if}

<div class="grid">
	{#each data.lists as { list, count, preview } (list.id)}
		<section class="card">
			<a class="head" href="/lists/{list.slug}">
				<h2>{list.name}</h2>
				<span class="muted num">{count} {count === 1 ? 'item' : 'items'}{list.dashboardCount > 0 ? ' · on the dashboard' : ''}</span>
			</a>
			{#if list.description}<p class="muted desc">{list.description}</p>{/if}
			{#if preview.length > 0}
				<ul>
					{#each preview as item (item.id)}<ItemRow {item} {list} people={data.people} />{/each}
				</ul>
			{:else}
				<p class="muted empty">Nothing here yet.</p>
			{/if}
			<a class="button" href="/lists/{list.slug}">Open and add</a>
		</section>
	{/each}
</div>

<form method="POST" action="/logout" class="logout">
	<button class="link">Sign out</button>
</form>

<style>
	.top {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
	}
	h1 {
		font-size: 28px;
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
		gap: 14px;
		align-items: start;
	}
	.card {
		display: grid;
		gap: 10px;
	}
	.head {
		display: grid;
		gap: 2px;
		text-decoration: none;
	}
	h2 {
		font-size: 20px;
	}
	.head span,
	.desc,
	.empty {
		font-size: 13px;
	}
	ul {
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.logout {
		text-align: center;
	}
	.link {
		padding: 8px;
		font-size: 14px;
		color: var(--muted);
		background: none;
		border: 0;
		cursor: pointer;
	}
</style>
