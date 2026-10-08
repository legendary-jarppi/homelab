<script lang="ts">
	import Card from './Card.svelte';
	import MotionTile from './MotionTile.svelte';
	import MotionViewer from './MotionViewer.svelte';
	import { clock, dayOf } from '$lib/dates';
	import { protectItems, tagLabel, type MotionItem } from '$lib/motion';
	import { night } from '$lib/night.svelte';
	import type { ProtectData } from '$lib/types';

	/** UniFi Protect's motion events (src/lib/server/protect.ts); null when unavailable. */
	let { protect }: { protect: ProtectData | null } = $props();

	/** Filters: a camera label and a smart detection; null = all. */
	let place = $state<string | null>(null);
	let tag = $state<string | null>(null);
	/** Index into `shown` open in the viewer. */
	let open = $state<number | null>(null);

	const items = $derived(protect ? protectItems(protect) : []);
	const places = $derived(protect?.cameras.map((c) => c.label) ?? []);
	/** Smart detections that occur, most frequent first. */
	const tags = $derived.by(() => {
		const counts = new Map<string, number>();
		for (const i of items) for (const t of i.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
		return [...counts].sort((a, b) => b[1] - a[1]).map(([t]) => t);
	});
	const shown = $derived(items.filter((i) => (place === null || i.place === place) && (tag === null || i.tags.includes(tag))));
	const todayKey = $derived(dayOf(night.now.toISOString()));
	const today = $derived(shown.filter((i) => dayOf(new Date(i.time).toISOString()) === todayKey).length);
	/** `shown` split into days (newest first), each item with its index in `shown`. */
	const days = $derived.by(() => {
		const groups: { day: string; items: { item: MotionItem; index: number }[] }[] = [];
		shown.forEach((item, index) => {
			const day = dayOf(new Date(item.time).toISOString());
			if (groups.at(-1)?.day !== day) groups.push({ day, items: [] });
			groups.at(-1)!.items.push({ item, index });
		});
		return groups;
	});
</script>

<Card title="Home cameras">
	{#snippet accessory()}
		{#if protect}<span>{today} today</span>{/if}
	{/snippet}
	{#if !protect}
		<p class="muted">UniFi Protect unavailable.</p>
	{:else}
		<div class="filters">
			<div class="chips" role="radiogroup" aria-label="Camera">
				<button role="radio" aria-checked={place === null} class:active={place === null} onclick={() => (place = null)}>All</button>
				{#each places as p (p)}
					<button role="radio" aria-checked={place === p} class:active={place === p} onclick={() => (place = p)}>{p}</button>
				{/each}
			</div>
			{#if tags.length > 0}
				<div class="chips" role="radiogroup" aria-label="Detection">
					<button role="radio" aria-checked={tag === null} class:active={tag === null} onclick={() => (tag = null)}>Any motion</button>
					{#each tags as t (t)}
						<button role="radio" aria-checked={tag === t} class:active={tag === t} onclick={() => (tag = t)}>{tagLabel(t)}</button>
					{/each}
				</div>
			{/if}
		</div>
		{#if shown.length === 0}
			<p class="muted">No motion in the last {protect.windowHours} hours.</p>
		{:else}
			<div class="events">
				{#each days as group (group.day)}
					<h3>{group.day === todayKey ? 'Today' : group.day} <span class="muted num">{group.items.length}</span></h3>
					<div class="grid">
						{#each group.items as { item, index } (item.key)}
							<MotionTile {item} caption={place === null ? `${clock(item.time)} · ${item.place}` : clock(item.time)} onopen={() => (open = index)} />
						{/each}
					</div>
				{/each}
			</div>
		{/if}
	{/if}
</Card>

{#if open !== null && shown.length > 0}
	<MotionViewer items={shown} bind:index={open} label="Home camera motion clips" onclose={() => (open = null)} />
{/if}

<style>
	p {
		margin: 0;
		font-size: 14px;
	}
	.filters {
		display: flex;
		flex-wrap: wrap;
		gap: 8px 16px;
	}
	.chips {
		display: flex;
		gap: 6px;
		overflow-x: auto;
		scrollbar-width: none;
	}
	.chips::-webkit-scrollbar {
		display: none;
	}
	.chips button {
		flex: none;
		padding: 6px 13px;
		font-size: 13px;
		font-weight: 600;
		border: 1px solid var(--border);
		border-radius: 999px;
		background: var(--surface-strong);
		color: var(--muted);
		cursor: pointer;
	}
	.chips button.active {
		color: var(--text);
		border-color: rgba(251, 191, 36, 0.5);
		background: rgba(251, 191, 36, 0.15);
	}
	/* Scrolls inside the card when it has a fixed height. */
	.events {
		flex: 1 1 auto;
		min-height: 0;
		max-height: 70dvh;
		overflow-y: auto;
		scrollbar-width: none;
	}
	.events::-webkit-scrollbar {
		display: none;
	}
	h3 {
		margin: 6px 0 8px;
		font-size: 13px;
		font-weight: 600;
		letter-spacing: 0.04em;
	}
	h3:not(:first-child) {
		margin-top: 16px;
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
		gap: 8px;
	}
	@media (min-width: 1000px) and (min-aspect-ratio: 5/4) {
		.events {
			max-height: none;
		}
	}
	@media (max-width: 640px) {
		.grid {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}
</style>
