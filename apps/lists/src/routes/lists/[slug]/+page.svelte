<script lang="ts">
	import ItemForm from '$lib/components/ItemForm.svelte';
	import ItemRow from '$lib/components/ItemRow.svelte';
	import { personColor } from '$lib/domain';

	let { data, form } = $props();

	const filtered = $derived(data.person !== null || data.q !== '');
	const filterHref = (person: number | null) => {
		const params = new URLSearchParams();
		if (person) params.set('p', String(person));
		if (data.q) params.set('q', data.q);
		const s = params.toString();
		return s ? `?${s}` : '?';
	};
</script>

<svelte:head><title>{data.list.name} · Lists</title></svelte:head>

<div class="top">
	<a class="back muted" href="/">← Lists</a>
	<a class="settings muted" href="/lists/{data.list.slug}/settings">List settings</a>
</div>

<section class="card">
	<h1>{data.list.name}</h1>
	{#if data.list.description}<p class="muted desc">{data.list.description}</p>{/if}
	<!-- Keyed by list: a renamed list (new slug) gets a fresh form. -->
	{#key data.list.id}
		<ItemForm
			list={data.list}
			people={data.people}
			services={data.services}
			action="?/add"
			submitLabel="Add"
			today={data.today}
			error={form?.error}
			quick
		/>
	{/key}
</section>

<section class="card">
	<div class="filters">
		{#if data.list.usePeople}
			<nav class="chips" aria-label="Show one person's">
				<a class="chip" class:selected={data.person === null} href={filterHref(null)}>Everyone</a>
				{#each data.people as p, i (p.id)}
					<a class="chip" class:selected={data.person === p.id} style:--c={personColor(i)} href={filterHref(p.id)}>{p.name}</a>
				{/each}
			</nav>
		{/if}
		<form method="GET" class="search" role="search">
			{#if data.person}<input type="hidden" name="p" value={data.person} />{/if}
			<input name="q" value={data.q} placeholder="Search" aria-label="Search this list" autocomplete="off" />
		</form>
	</div>

	{#if data.items.length > 0}
		<p class="muted count num">{data.items.length} {data.items.length === 1 ? 'item' : 'items'}{filtered ? ' shown' : ''}</p>
		<ul>
			{#each data.items as item (item.id)}<ItemRow {item} list={data.list} people={data.people} />{/each}
		</ul>
	{:else}
		<p class="muted">{filtered ? 'Nothing matches.' : 'Nothing here yet: add the first one above.'}</p>
	{/if}
</section>

<style>
	.top {
		display: flex;
		justify-content: space-between;
		font-size: 14px;
	}
	.top a {
		text-decoration: none;
	}
	.card {
		display: grid;
		gap: 12px;
	}
	h1 {
		font-size: 26px;
	}
	.desc {
		font-size: 14px;
		margin-top: -6px;
	}
	.filters {
		display: flex;
		flex-wrap: wrap;
		gap: 10px;
		align-items: center;
		justify-content: space-between;
	}
	.search input {
		width: 200px;
		min-height: 38px;
		padding: 6px 14px;
		font-size: 15px;
		background: rgba(0, 0, 0, 0.3);
		border: 1px solid var(--border);
		border-radius: 999px;
		outline: none;
	}
	.search input:focus {
		border-color: var(--accent);
	}
	.count {
		font-size: 13px;
	}
	ul {
		margin: 0;
		padding: 0;
		list-style: none;
	}
	@media (max-width: 520px) {
		.search,
		.search input {
			width: 100%;
		}
	}
</style>
