<script lang="ts">
	import { page } from '$app/state';
	import { PEOPLE, type PersonId } from '$lib/domain';

	let { people }: { people: PersonId[] } = $props();

	const options = [{ id: '', name: 'Both' }, ...PEOPLE];
	const selected = $derived(people.length === 1 ? people[0] : '');
</script>

<nav class="segmented" aria-label="Person">
	{#each options as o (o.id)}
		<a
			href={o.id ? `${page.url.pathname}?p=${o.id}` : page.url.pathname}
			class:selected={o.id === selected}
			aria-current={o.id === selected ? 'true' : undefined}
			data-sveltekit-noscroll
			data-sveltekit-replacestate>{o.name}</a
		>
	{/each}
</nav>
