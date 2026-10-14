<script lang="ts">
	import ListForm from '$lib/components/ListForm.svelte';

	let { form } = $props();
</script>

<svelte:head><title>New list · Lists</title></svelte:head>

<a class="back muted" href="/">← Lists</a>
<section class="card">
	<h1>New list</h1>
	<ListForm action="" submitLabel="Create list" error={form?.error} />
</section>

<style>
	.back {
		font-size: 14px;
		text-decoration: none;
	}
	.card {
		display: grid;
		gap: 16px;
		max-width: 620px;
	}
	h1 {
		font-size: 24px;
	}
</style>
