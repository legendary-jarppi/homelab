<script lang="ts">
	import { page } from '$app/state';
	import Card from '$lib/components/Card.svelte';
</script>

<svelte:head><title>{page.status} · Telescope</title></svelte:head>

<Card title={page.status === 404 ? 'Not found' : 'Unavailable'}>
	<p>{page.error?.message ?? 'Something went wrong.'}</p>
	<p class="muted">{#if page.data.public}<a href="/gallery">Back to the gallery</a>{:else}<a href="/">Back to Live</a>{/if}</p>
</Card>

<style>
	p {
		margin: 0;
		font-size: 14px;
	}
</style>
