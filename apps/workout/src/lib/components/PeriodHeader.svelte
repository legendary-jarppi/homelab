<script lang="ts">
	import PersonFilter from './PersonFilter.svelte';
	import type { PersonId } from '$lib/domain';

	interface Props {
		title: string;
		people: PersonId[];
		/** Links to the neighbouring periods; omitted when there is none. */
		prev?: string;
		next?: string;
	}

	let { title, people, prev, next }: Props = $props();
	const query = $derived(people.length === 1 ? `?p=${people[0]}` : '');
</script>

<div class="header">
	<div class="title">
		{#if prev}<a href="{prev}{query}" aria-label="Previous">‹</a>{:else}<span></span>{/if}
		<h1>{title}</h1>
		{#if next}<a href="{next}{query}" aria-label="Next">›</a>{:else}<span></span>{/if}
	</div>
	<PersonFilter {people} />
</div>

<style>
	.header {
		display: grid;
		gap: 10px;
		width: 100%;
		max-width: 520px;
		margin: 0 auto;
	}
	.title {
		display: grid;
		grid-template-columns: 44px 1fr 44px;
		align-items: center;
		text-align: center;
	}
	h1 {
		font-size: 24px;
	}
	a {
		display: grid;
		place-items: center;
		height: 44px;
		font-size: 30px;
		text-decoration: none;
		color: var(--muted);
	}
</style>
