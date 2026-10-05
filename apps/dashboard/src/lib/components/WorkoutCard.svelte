<script lang="ts">
	import Card from './Card.svelte';
	import type { WorkoutSummary } from '$lib/types';

	/** `href`: the workout app; the whole card links there. */
	let { workout, href }: { workout: WorkoutSummary | null; href: string } = $props();

	/** Same colours as apps/workout. */
	const COLOR: Record<string, string> = { treadmill: 'var(--down)', crosstrainer: 'var(--up)', rowing: 'var(--ok)' };

	/** Bars share one scale so the two people compare at a glance. */
	const scale = $derived(Math.max(1, ...(workout?.people.map((p) => p.meters) ?? [])));
	const km = (meters: number) => String(Number((meters / 1000).toFixed(1)));
	const day = (iso: string) => `${Number(iso.slice(8, 10))}.${Number(iso.slice(5, 7))}.`;
</script>

<!-- New tab: the dashboard keeps running (from the iPad home screen this opens Safari). -->
<a {href} target="_blank" rel="noopener" title="Open the workout log">
<Card title="Workouts">
	{#snippet accessory()}
		{#if workout}<span>Week {workout.week.week}<span class="dates">{` · ${day(workout.week.start)}–${day(workout.week.end)}`}</span></span>{/if}
	{/snippet}
	{#if workout}
		<div class="people">
			{#each workout.people as person (person.id)}
				<div class="person">
					<div class="head">
						<span class="name">
							{person.name}
							{#if person.workouts > 0}<small class="muted">{person.workouts} {person.workouts === 1 ? 'workout' : 'workouts'}</small>{/if}
						</span>
						<span class="value num">{km(person.meters)}<small>km</small></span>
					</div>
					<div class="track" aria-hidden="true">
						<div class="bar" style:width="{(person.meters / scale) * 100}%">
							{#each person.byMachine.filter((m) => m.meters > 0) as m (m.id)}
								<span style:flex={m.meters} style:background={COLOR[m.id]}></span>
							{/each}
						</div>
					</div>
					<div class="detail muted">
						{#if person.workouts === 0}
							No workouts yet
						{:else}
							{#each person.byMachine.filter((m) => m.meters > 0) as m (m.id)}
								<span title={m.name}><i style:background={COLOR[m.id]}></i>{m.short} <span class="num">{km(m.meters)}</span></span>
							{/each}
						{/if}
					</div>
				</div>
			{/each}
		</div>
	{:else}
		<p class="muted">Workout log unavailable.</p>
	{/if}
</Card>
</a>

<style>
	a {
		display: block;
		height: 100%;
		color: inherit;
		text-decoration: none;
		border-radius: var(--radius);
		-webkit-tap-highlight-color: transparent;
		transition: transform 0.1s, opacity 0.2s;
	}
	a:active {
		transform: scale(0.985);
		opacity: 0.85;
	}
	a:focus-visible {
		outline: 2px solid var(--down);
		outline-offset: 2px;
	}
	.people {
		flex: 1;
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
		align-content: space-evenly;
		gap: 12px 20px;
	}
	.person {
		display: grid;
		gap: 6px;
		min-width: 0;
	}
	.head {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		gap: 8px;
	}
	.name {
		font-size: 15px;
		font-weight: 600;
	}
	.name small {
		margin-left: 6px;
		font-size: 12px;
		font-weight: 400;
	}
	.value {
		font-size: 28px;
		font-weight: 650;
		line-height: 1;
	}
	.value small {
		margin-left: 3px;
		font-size: 0.45em;
		font-weight: 500;
		color: var(--muted);
	}
	.track {
		height: 6px;
		border-radius: 3px;
		background: rgba(255, 255, 255, 0.06);
		overflow: hidden;
	}
	.bar {
		height: 100%;
		display: flex;
		gap: 2px;
	}
	.detail {
		display: flex;
		flex-wrap: wrap;
		gap: 2px 12px;
		font-size: 13px;
	}
	.detail i {
		display: inline-block;
		width: 7px;
		height: 7px;
		margin-right: 5px;
		border-radius: 50%;
		vertical-align: 0.1em;
	}
	p {
		margin: 0;
		font-size: 14px;
	}
	/* iPad landscape gives the card a fixed slot (container set in +page.svelte): drop details that do not fit. */
	@container workout (max-width: 300px) {
		.dates {
			display: none;
		}
	}
	@container workout (max-height: 200px) {
		.detail {
			display: none;
		}
	}
</style>
