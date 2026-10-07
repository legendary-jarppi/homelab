<script lang="ts">
	import BarChart from '$lib/components/BarChart.svelte';
	import PeriodHeader from '$lib/components/PeriodHeader.svelte';
	import Totals from '$lib/components/Totals.svelte';
	import WeekTable from '$lib/components/WeekTable.svelte';
	import { chartsPerPerson } from '$lib/charts';
	import { MONTHS, dayLabel, formatKm, machineName, personName } from '$lib/domain';

	let { data } = $props();

	/** "YYYY-MM" of the month `delta` months away. */
	function shift(delta: number): string {
		const d = new Date(Date.UTC(data.year, data.month - 1 + delta, 1));
		return d.toISOString().slice(0, 7);
	}

	const prev = $derived(shift(-1));
	const next = $derived(shift(1));
	const dayCharts = $derived(
		chartsPerPerson(data.days, data.people, ({ day }) => {
			const n = Number(day.slice(8, 10));
			return { label: n === 1 || n % 5 === 0 ? String(n) : '', title: dayLabel(day) };
		})
	);
	const currentDay = $derived(data.days.findIndex((d) => d.day === data.today));
	const workouts = $derived(data.workouts.filter((w) => data.people.includes(w.person)));
</script>

<svelte:head><title>{MONTHS[data.month - 1]} {data.year} · Workouts</title></svelte:head>

<PeriodHeader
	title="{MONTHS[data.month - 1]} {data.year}"
	people={data.people}
	prev={prev >= data.firstMonth ? `/month/${prev}` : undefined}
	next={next <= data.today.slice(0, 7) ? `/month/${next}` : undefined}
/>

<section class="card">
	<h2>Total</h2>
	<div class="people">
		{#each data.people as p (p)}
			<Totals name={personName(p)} totals={data.total[p]} />
		{/each}
	</div>
</section>

<section class="card">
	<h2>By day</h2>
	<div class="charts">
		{#each dayCharts as c (c.person)}
			<BarChart name={data.people.length > 1 ? personName(c.person) : undefined} bars={c.bars} max={c.max} current={currentDay} />
		{/each}
	</div>
</section>

<section class="card">
	<h2>Weeks</h2>
	<p class="muted hint">Whole weeks, including days in the neighbouring months.</p>
	<WeekTable weeks={data.weeks} people={data.people} currentStart={data.currentWeekStart} />
</section>

<section class="card">
	<h2>Workouts</h2>
	{#if workouts.length === 0}
		<p class="muted">None this month.</p>
	{:else}
		<ul class="list">
			{#each workouts as w (w.id)}
				<li>
					<a href="/entries/{w.id}">
						<span class="muted day">{dayLabel(w.day)}</span>
						<span>{personName(w.person)}</span>
						<span class="what"><span class="dot" style="background: var(--{w.machine})"></span> {machineName(w.machine)}</span>
						<span class="num km">{formatKm(w.meters)} km</span>
					</a>
				</li>
			{/each}
		</ul>
	{/if}
</section>

<style>
	.people,
	.charts {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 280px), 1fr));
		gap: 18px 24px;
	}
	.people {
		grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
	}
	.hint {
		margin: -6px 0 8px;
		font-size: 13px;
	}
	.list {
		margin: 0;
		padding: 0;
		list-style: none;
		columns: 2 320px;
		column-gap: 24px;
	}
	.list li {
		break-inside: avoid;
	}
	.list a {
		display: grid;
		grid-template-columns: 5.5em 4em 1fr auto;
		gap: 8px;
		align-items: center;
		padding: 9px 2px;
		font-size: 15px;
		text-decoration: none;
		border-bottom: 1px solid var(--border);
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
