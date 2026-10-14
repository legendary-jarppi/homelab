<script lang="ts">
	import { enhance } from '$app/forms';
	import ListForm from '$lib/components/ListForm.svelte';

	let { data, form } = $props();
</script>

<svelte:head><title>Settings · {data.list.name} · Lists</title></svelte:head>

<a class="back muted" href="/lists/{data.list.slug}">← {data.list.name}</a>

<section class="card">
	<h1>List settings</h1>
	<ListForm list={data.list} action="?/save" submitLabel="Save" error={form?.error} />
	<p class="muted hint">Turning a field off hides it; items keep what was entered, and it shows again if the field is turned back on.</p>
</section>

<section class="card danger-zone">
	<h2>Delete this list</h2>
	<p class="muted">Deletes the list and its {data.count} {data.count === 1 ? 'item' : 'items'}. This cannot be undone (the nightly backup has a copy).</p>
	<form method="POST" action="?/delete" use:enhance>
		<label class="field">
			<span>Type <b>{data.list.name}</b> to confirm</span>
			<input name="confirm" autocomplete="off" />
		</label>
		{#if form?.deleteError}<p class="error" role="alert">{form.deleteError}</p>{/if}
		<button class="button danger">Delete list</button>
	</form>
</section>

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
	.hint {
		font-size: 13px;
	}
	.danger-zone form {
		display: grid;
		gap: 10px;
	}
	.danger-zone .button {
		justify-self: start;
	}
</style>
