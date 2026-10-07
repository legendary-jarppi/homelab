<script lang="ts">
	import EntryForm from '$lib/components/EntryForm.svelte';
	import Totals from '$lib/components/Totals.svelte';
	import { PEOPLE, dayLabel, formatKm, machineName, personName, shortDate, splitTotal, addDays } from '$lib/domain';

	let { data, form } = $props();

	const week = $derived(data.overview.thisWeek);
	const logged = $derived(form?.logged);
</script>

<svelte:head><title>Log · Workouts</title></svelte:head>

<section class="card">
	<h2>Log a workout</h2>
	<EntryForm
		action="?/add"
		person={data.person}
		machine={data.lastMachines[data.person] ?? 'treadmill'}
		day={data.today}
		today={data.today}
		lastMachines={data.lastMachines}
		submitLabel="Log"
		clearOnSuccess
		error={form?.error}
	/>
	{#if logged}
		<p class="logged" role="status">
			Logged {formatKm(logged.meters)} km {machineName(logged.machine).toLowerCase()} for {personName(logged.person)}{logged.day === data.today ? '' : ` on ${dayLabel(logged.day)}`}.
		</p>
	{/if}
</section>

<section class="card">
	<h2>
		This week <span class="muted">· week {week.week}, {shortDate(week.start)}–{shortDate(addDays(week.start, 6))}</span>
	</h2>
	<div class="people">
		{#each PEOPLE as p (p.id)}
			<Totals
				name={p.name}
				totals={week.bucket[p.id]}
				note="Last week {formatKm(splitTotal(data.overview.lastWeek.bucket[p.id].split), 1)} km · {data.today.slice(0, 4)} so far {formatKm(splitTotal(data.overview.yearToDate[p.id].split), 1)} km"
			/>
		{/each}
	</div>
</section>

<section class="card">
	<h2>Latest</h2>
	{#if data.recent.length === 0}
		<p class="muted">Nothing logged yet.</p>
	{:else}
		<ul class="recent">
			{#each data.recent as w (w.id)}
				<li>
					<a href="/entries/{w.id}">
						<span class="muted day">{dayLabel(w.day)}</span>
						<span class="who">{personName(w.person)}</span>
						<span class="what"><span class="dot" style="background: var(--{w.machine})"></span> {machineName(w.machine)}</span>
						<span class="num km">{formatKm(w.meters)} km</span>
					</a>
				</li>
			{/each}
		</ul>
	{/if}
</section>

<style>
	section {
		width: 100%;
		max-width: 560px;
		margin: 0 auto;
	}
	.logged {
		margin: 12px 0 0;
		color: var(--ok);
	}
	.people {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 18px;
	}
	.recent {
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.recent a {
		display: grid;
		grid-template-columns: 5.5em 4em 1fr auto;
		gap: 8px;
		align-items: center;
		padding: 10px 2px;
		font-size: 15px;
		text-decoration: none;
		border-bottom: 1px solid var(--border);
	}
	.recent li:last-child a {
		border-bottom: 0;
	}
	.day {
		font-size: 13px;
	}
	.what {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.km {
		font-weight: 600;
	}
</style>
