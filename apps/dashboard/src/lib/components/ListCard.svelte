<script lang="ts">
	import Card from './Card.svelte';
	import { eventTime } from '$lib/dates';
	import { night } from '$lib/night.svelte';
	import type { ListsData } from '$lib/types';

	/** One list from apps/lists ("Watched movies", first items in the list's order); tapping opens it there. */
	let { list, people, appUrl }: { list: ListsData['lists'][number]; people: ListsData['people']; appUrl: string } = $props();

	/** Same palette and order as apps/lists (src/lib/domain.ts), so a person has one colour in both. */
	const COLORS = ['#38bdf8', '#f472b6', '#fbbf24', '#34d399', '#c084fc', '#fb923c', '#a3e635', '#22d3ee'];
	const person = $derived(new Map(people.map((p, i) => [p.id, { ...p, color: COLORS[i % COLORS.length] }])));
	const href = $derived(`${appUrl}/lists/${list.slug}`);
</script>

<Card title={list.name}>
	{#snippet accessory()}
		<a class="open" {href} target="_blank" rel="noopener">Open ↗</a>
	{/snippet}
	{#if list.items.length === 0}
		<p class="muted empty">Nothing on this list yet.</p>
	{:else}
		<ul>
			{#each list.items as it (it.id)}
				<li>
					<span class="main">
						<span class="title">{it.title}</span>
						{#if list.usesService && it.service}<span class="service muted">{it.service}</span>{/if}
					</span>
					{#if list.usesPeople && it.people.length > 0}
						<span class="who">
							{#each it.people as id (id)}
								{@const p = person.get(id)}
								{#if p}<span class="person" style:--c={p.color} title={p.name}>{p.short}</span>{/if}
							{/each}
						</span>
					{/if}
					{#if it.day}<span class="day muted num">{eventTime(it.day, night.now)}</span>{/if}
				</li>
			{/each}
		</ul>
	{/if}
</Card>

<style>
	.open {
		color: var(--muted);
		text-decoration: none;
	}
	.empty {
		margin: 0;
		font-size: 14px;
	}
	ul {
		margin: 0;
		padding: 0;
		list-style: none;
		display: grid;
		align-content: start;
		gap: 2px;
		flex: 1 1 auto;
		min-height: 0;
		overflow: hidden;
	}
	li {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 7px 0;
		border-top: 1px solid var(--border);
		min-width: 0;
	}
	li:first-child {
		border-top: 0;
	}
	.main {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: baseline;
		gap: 8px;
	}
	.title {
		font-size: 15px;
		font-weight: 600;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.service {
		flex: none;
		font-size: 12px;
	}
	.who {
		flex: none;
		display: flex;
		gap: 3px;
	}
	.person {
		display: inline-grid;
		place-items: center;
		min-width: 24px;
		height: 20px;
		padding: 0 5px;
		font-size: 10px;
		font-weight: 700;
		color: #04121c;
		background: var(--c);
		border-radius: 999px;
	}
	.day {
		flex: none;
		font-size: 13px;
		min-width: 64px;
		text-align: right;
	}
</style>
