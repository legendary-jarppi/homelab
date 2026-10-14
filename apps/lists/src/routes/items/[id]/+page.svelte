<script lang="ts">
	import { enhance } from '$app/forms';
	import ItemForm from '$lib/components/ItemForm.svelte';

	let { data, form } = $props();
	let target = $state<number | ''>('');
	const targetList = $derived(data.others.find((l) => l.id === target));
</script>

<svelte:head><title>{data.item.title} · Lists</title></svelte:head>

<a class="back muted" href="/lists/{data.list.slug}">← {data.list.name}</a>

<section class="card">
	<h1>Edit item</h1>
	<!-- Keyed by item and list: after a move, the form shows the new list's fields. -->
	{#key `${data.item.id}-${data.list.id}`}
		<ItemForm
			list={data.list}
			item={data.item}
			people={data.people}
			services={data.services}
			action="?/save"
			submitLabel="Save"
			today={data.today}
			error={form?.error}
		/>
	{/key}
</section>

{#if data.others.length > 0}
	<section class="card">
		<h2>Move to another list</h2>
		<form method="POST" action="?/move" use:enhance class="move">
			<label class="field">
				<span class="sr">List</span>
				<select name="list" bind:value={target} required>
					<option value="" disabled>Choose a list</option>
					{#each data.others as l (l.id)}<option value={l.id}>{l.name}</option>{/each}
				</select>
			</label>
			<button class="button" disabled={target === ''}>Move</button>
		</form>
		{#if targetList?.useDate && !data.item.day}<p class="muted hint">It gets today's date there; you can change it after moving.</p>{/if}
		{#if form?.moveError}<p class="error" role="alert">{form.moveError}</p>{/if}
	</section>
{/if}

<form method="POST" action="?/delete" class="delete" onsubmit={(e) => !confirm(`Delete “${data.item.title}”?`) && e.preventDefault()}>
	<button class="button danger">Delete item</button>
</form>

<style>
	.back {
		font-size: 14px;
		text-decoration: none;
	}
	.card {
		display: grid;
		gap: 14px;
		max-width: 620px;
	}
	h1 {
		font-size: 24px;
	}
	h2 {
		font-size: 18px;
	}
	.move {
		display: flex;
		gap: 8px;
	}
	.move .field {
		flex: 1;
	}
	.hint {
		font-size: 13px;
	}
	.delete {
		max-width: 620px;
	}
</style>
