<script lang="ts">
	import { formatDay, initials, personColor, type Item, type List, type Person } from '$lib/domain';

	/** One item in a list; tap to edit. `people` gives names and colours (by position). */
	let { item, list, people }: { item: Item; list: List; people: Person[] } = $props();

	const who = $derived(list.usePeople ? people.map((p, i) => ({ ...p, i })).filter((p) => item.people.includes(p.id)) : []);
</script>

<li>
	<a class="row" href="/items/{item.id}">
		<span class="main">
			<span class="title">{item.title}</span>
			{#if list.useNote && item.note}<span class="note muted">{item.note}</span>{/if}
		</span>
		<span class="meta">
			{#if who.length > 0}
				<span class="who">
					{#each who as p (p.id)}<span class="person" style:--c={personColor(p.i)} title={p.name}>{initials(p.name)}</span>{/each}
				</span>
			{/if}
			{#if list.useService && item.service}<span class="service">{item.service}</span>{/if}
			{#if list.useDate && item.day}<span class="day num muted">{formatDay(item.day)}</span>{/if}
		</span>
	</a>
	{#if list.useLink && item.link}
		<a class="open" href={item.link} target="_blank" rel="noopener noreferrer" aria-label="Open {item.title}">
			<svg viewBox="0 0 24 24"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></svg>
		</a>
	{/if}
</li>

<style>
	li {
		display: flex;
		align-items: stretch;
		gap: 4px;
		border-top: 1px solid var(--border);
	}
	li:first-child {
		border-top: 0;
	}
	.row {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 12px 4px;
		text-decoration: none;
	}
	.main {
		min-width: 0;
		display: grid;
		gap: 2px;
	}
	.title {
		font-size: 16px;
		font-weight: 600;
		overflow-wrap: anywhere;
	}
	.note {
		font-size: 13px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.meta {
		flex: none;
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		justify-content: flex-end;
		gap: 6px 10px;
		max-width: 55%;
	}
	.who {
		display: flex;
		gap: 3px;
	}
	.service {
		padding: 2px 8px;
		font-size: 12px;
		font-weight: 600;
		border: 1px solid var(--border);
		border-radius: 999px;
		color: var(--muted);
	}
	.day {
		font-size: 13px;
		min-width: 72px;
		text-align: right;
	}
	.open {
		flex: none;
		width: 40px;
		display: grid;
		place-items: center;
		color: var(--accent);
	}
	.open svg {
		width: 18px;
		height: 18px;
		fill: none;
		stroke: currentColor;
		stroke-width: 2;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
	@media (max-width: 520px) {
		.row {
			flex-direction: column;
			align-items: stretch;
			gap: 6px;
		}
		.meta {
			max-width: none;
			justify-content: flex-start;
		}
		.day {
			min-width: 0;
			text-align: left;
		}
	}
</style>
