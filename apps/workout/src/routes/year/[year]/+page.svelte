<script lang="ts">
	import BarChart from '$lib/components/BarChart.svelte';
	import PeriodHeader from '$lib/components/PeriodHeader.svelte';
	import Totals from '$lib/components/Totals.svelte';
	import WeekTable from '$lib/components/WeekTable.svelte';
	import { chartsPerPerson } from '$lib/charts';
	import { MONTHS, addDays, formatKm, personName, shortDate, splitTotal } from '$lib/domain';

	let { data } = $props();

	const query = $derived(data.people.length === 1 ? `?p=${data.people[0]}` : '');
	const thisYear = $derived(Number(data.today.slice(0, 4)));
	const firstYear = $derived(data.years[0]?.year ?? thisYear);

	const monthCharts = $derived(
		chartsPerPerson(data.months, data.people, (m, i) => ({
			label: MONTHS[i].slice(0, 3),
			title: `${MONTHS[i]} ${data.year}`,
			href: `/month/${m.key}${query}`
		}))
	);
	const weekCharts = $derived(
		chartsPerPerson(data.weeks, data.people, (w) => ({
			label: w.week % 4 === 1 ? String(w.week) : '',
			title: `Week ${w.week} · ${shortDate(w.start)}–${shortDate(addDays(w.start, 6))}`
		}))
	);
	const yearCharts = $derived(
		chartsPerPerson(data.years, data.people, (y) => ({
			label: String(y.year),
			title: String(y.year),
			href: `/year/${y.year}${query}`
		}))
	);
	const currentMonth = $derived(data.year === thisYear ? Number(data.today.slice(5, 7)) - 1 : -1);
	const currentWeek = $derived(data.weeks.findIndex((w) => w.start === data.currentWeekStart));
	const currentYear = $derived(data.years.findIndex((y) => y.year === data.year));
</script>

<svelte:head><title>{data.year} · Workouts</title></svelte:head>

<PeriodHeader
	title={String(data.year)}
	people={data.people}
	prev={data.year > firstYear ? `/year/${data.year - 1}` : undefined}
	next={data.year < thisYear ? `/year/${data.year + 1}` : undefined}
/>

<section class="card">
	<h2>Total</h2>
	<div class="people">
		{#each data.people as p (p)}
			<Totals
				name={personName(p)}
				totals={data.total[p]}
				note={data.weeks.length > 0 ? `${formatKm(splitTotal(data.total[p].split) / data.weeks.length, 1)} km / week on average` : undefined}
			/>
		{/each}
	</div>
</section>

<section class="card">
	<h2>By month</h2>
	<div class="charts">
		{#each monthCharts as c (c.person)}
			<BarChart name={data.people.length > 1 ? personName(c.person) : undefined} bars={c.bars} max={c.max} current={currentMonth} />
		{/each}
	</div>
</section>

<section class="card">
	<h2>By week</h2>
	<div class="charts">
		{#each weekCharts as c (c.person)}
			<BarChart name={data.people.length > 1 ? personName(c.person) : undefined} bars={c.bars} max={c.max} current={currentWeek} />
		{/each}
	</div>
</section>

<section class="card">
	<h2>Weekly summary</h2>
	{#if data.weeks.length === 0}
		<p class="muted">No weeks yet.</p>
	{:else}
		<WeekTable weeks={data.weeks} people={data.people} currentStart={data.currentWeekStart} cumulative />
	{/if}
</section>

{#if data.years.length > 1}
	<section class="card">
		<h2>All years</h2>
		<div class="charts">
			{#each yearCharts as c (c.person)}
				<BarChart name={data.people.length > 1 ? personName(c.person) : undefined} bars={c.bars} max={c.max} current={currentYear} height={110} />
			{/each}
		</div>
	</section>
{/if}

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
</style>
