<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import CabinCard from '$lib/components/CabinCard.svelte';
	import CabinTile from '$lib/components/CabinTile.svelte';
	import CalendarCard from '$lib/components/CalendarCard.svelte';
	import CameraTile from '$lib/components/CameraTile.svelte';
	import CameraViewer from '$lib/components/CameraViewer.svelte';
	import Card from '$lib/components/Card.svelte';
	import HomelabCard from '$lib/components/HomelabCard.svelte';
	import NetworkCard from '$lib/components/NetworkCard.svelte';
	import NightScreen from '$lib/components/NightScreen.svelte';
	import PackagesCard from '$lib/components/PackagesCard.svelte';
	import PresenceCard from '$lib/components/PresenceCard.svelte';
	import ProtectCard from '$lib/components/ProtectCard.svelte';
	import SpeedtestCard from '$lib/components/SpeedtestCard.svelte';
	import TopBar from '$lib/components/TopBar.svelte';
	import TopDevicesCard from '$lib/components/TopDevicesCard.svelte';
	import WanCard from '$lib/components/WanCard.svelte';
	import WorkoutCard from '$lib/components/WorkoutCard.svelte';
	import { backupProblem } from '$lib/backup';
	import { cabinEvents } from '$lib/cabin';
	import { dayOf } from '$lib/dates';
	import { night } from '$lib/night.svelte';
	import type { CabinData, CalendarData, DashboardTab, LiveData, PackagesData, PresenceData, ProtectData, SlowData, WeatherData, WorkoutSummary } from '$lib/types';

	let { data } = $props();

	// Seeded from the server render, then refreshed by polling.
	let live = $state<LiveData | null>(untrack(() => data.live));
	let slow = $state<SlowData | null>(untrack(() => data.slow));
	let weather = $state<WeatherData[] | null>(untrack(() => data.weather));
	let workout = $state<WorkoutSummary | null>(untrack(() => data.workout));
	let calendar = $state<CalendarData | null>(untrack(() => data.calendar));
	let packages = $state<PackagesData | null>(untrack(() => data.packages));
	let presence = $state<PresenceData | null>(untrack(() => data.presence));
	let cabin = $state<CabinData | null>(untrack(() => data.cabin));
	let protect = $state<ProtectData | null>(untrack(() => data.protect));
	let viewer = $state<number | null>(null);
	let tab = $state<DashboardTab>('home');
	/** The Cameras tab's view; opening the tab always starts on the live pictures. */
	let cameraView = $state<'live' | 'detections'>('live');
	$effect(() => {
		if (tab !== 'cameras') cameraView = 'live';
	});
	const todayKey = $derived(dayOf(night.now.toISOString()));
	/** Motion events today from the home cameras and the cabin, shown on the Detections switch. */
	const motionToday = $derived(
		(protect?.events.filter((e) => dayOf(new Date(e.start).toISOString()) === todayKey).length ?? 0) +
			(cabin ? cabinEvents(cabin.snapshots).filter((e) => dayOf(new Date(e.time).toISOString()) === todayKey).length : 0)
	);
	const liveTiles = $derived(data.cameras.length + (data.cabinConfigured ? 1 : 0));

	/** A wall display goes back to the main page by itself after this long untouched. */
	const RETURN_HOME_MS = 2 * 60_000;
	$effect(() => {
		if (tab === 'home') return;
		let timer = setTimeout(() => (tab = 'home'), RETURN_HOME_MS);
		const touched = () => {
			clearTimeout(timer);
			timer = setTimeout(() => (tab = 'home'), RETURN_HOME_MS);
		};
		window.addEventListener('pointerdown', touched);
		return () => {
			clearTimeout(timer);
			window.removeEventListener('pointerdown', touched);
		};
	});

	/** Live data older than three refresh intervals counts as stale. */
	const liveStale = $derived(!live || night.now.getTime() - live.updatedAt > 30_000);
	/** Backup status from Prometheus (via /api/slow, every 60 s); null = unknown: none yet, or stale like live data. */
	const backup = $derived(slow && night.now.getTime() - slow.updatedAt <= 3 * 60_000 ? slow.homelab.backup : null);
	const healthy = $derived(
		!liveStale &&
			(live?.devices.every((d) => d.online) ?? false) &&
			(slow
				? slow.homelab.pods.problem === 0 &&
					slow.homelab.targetsDown === 0 &&
					backupProblem(slow.homelab.backup, night.now.getTime()) === null
				: true)
	);

	async function refreshPackages() {
		const response = await fetch('/api/packages', { cache: 'no-store' });
		if (response.ok) packages = await response.json();
	}
	onMount(() => {
		const stopNight = night.start();
		const RETRY_MS = 30_000;
		const start = Date.now();
		// `due`: next fetch time. Data missing from the server render is fetched right away.
		const pollers: { url: string; everyMs: number; apply: (body: unknown) => void; due: number }[] = [
			{ url: '/api/live', everyMs: 10_000, apply: (b) => (live = b as LiveData), due: live ? start + 10_000 : 0 },
			{ url: '/api/slow', everyMs: 60_000, apply: (b) => (slow = b as SlowData), due: slow ? start + 60_000 : 0 },
			// The server checks each carrier only as often as it allows; this just picks up the results.
			{ url: '/api/packages', everyMs: 60_000, apply: (b) => (packages = b as PackagesData), due: packages ? start + 60_000 : 0 }
		];
		if (data.weatherConfigured) {
			pollers.push({ url: '/api/weather', everyMs: 10 * 60_000, apply: (b) => (weather = b as WeatherData[]), due: weather ? start + 10 * 60_000 : 0 });
		}
		if (data.workoutConfigured) {
			pollers.push({ url: '/api/workout', everyMs: 60_000, apply: (b) => (workout = b as WorkoutSummary), due: workout ? start + 60_000 : 0 });
		}
		if (data.calendarConfigured) {
			pollers.push({ url: '/api/calendar', everyMs: 5 * 60_000, apply: (b) => (calendar = b as CalendarData), due: calendar ? start + 5 * 60_000 : 0 });
		}
		if (data.presenceConfigured) {
			pollers.push({ url: '/api/presence', everyMs: 30_000, apply: (b) => (presence = b as PresenceData), due: presence ? start + 30_000 : 0 });
		}
		if (data.cabinConfigured) {
			pollers.push({ url: '/api/cabin', everyMs: 60_000, apply: (b) => (cabin = b as CabinData), due: cabin ? start + 60_000 : 0 });
		}
		if (data.protectConfigured) {
			pollers.push({ url: '/api/protect', everyMs: 30_000, apply: (b) => (protect = b as ProtectData), due: protect ? start + 30_000 : 0 });
		}

		const tick = async (force = false) => {
			if (document.visibilityState !== 'visible') return;
			const now = Date.now();
			await Promise.all(
				pollers
					.filter((p) => force || now >= p.due)
					.map(async (p) => {
						// Pending until this fetch settles; a failure retries sooner than the regular interval.
						p.due = now + p.everyMs;
						try {
							const response = await fetch(p.url, { cache: 'no-store' });
							// Session expired (e.g. secret rotated): back to the login page.
							if (response.status === 401) return location.assign('/login');
							if (!response.ok) throw new Error(String(response.status));
							p.apply(await response.json());
						} catch {
							// Keep showing the last data; staleness is surfaced in the top bar.
							p.due = now + Math.min(RETRY_MS, p.everyMs);
						}
					})
			);
		};
		const timer = setInterval(tick, 1000);
		const onVisible = () => document.visibilityState === 'visible' && tick(true);
		document.addEventListener('visibilitychange', onVisible);
		return () => {
			stopNight();
			clearInterval(timer);
			document.removeEventListener('visibilitychange', onVisible);
		};
	});
</script>

{#if night.active}
	<NightScreen {weather} ok={healthy} />
{/if}

<div class="page" class:dimmed={night.active}>
	<TopBar {weather} weatherConfigured={data.weatherConfigured} {live} {liveStale} {backup} bind:tab />

	{#if tab === 'home'}
		<main class="grid home-page" class:with-workout={data.workoutConfigured}>
			<div class="area presence">
				<PresenceCard {presence} configured={data.presenceConfigured} />
			</div>
			<div class="area calendar">
				<CalendarCard {calendar} configured={data.calendarConfigured} />
			</div>
			<div class="area packages">
				<PackagesCard data={packages} onchange={refreshPackages} />
			</div>
			{#if data.workoutConfigured}
				<div class="area workout">
					<WorkoutCard {workout} href={data.workoutAppUrl} />
				</div>
			{/if}
		</main>
	{:else if tab === 'cameras'}
		<div class="views" role="tablist" aria-label="Cameras view">
			<button role="tab" aria-selected={cameraView === 'live'} class:active={cameraView === 'live'} onclick={() => (cameraView = 'live')}>Live</button>
			<button role="tab" aria-selected={cameraView === 'detections'} class:active={cameraView === 'detections'} onclick={() => (cameraView = 'detections')}>
				Detections{#if motionToday > 0}<span class="today num" aria-label="{motionToday} today">{motionToday}</span>{/if}
			</button>
		</div>
		{#if cameraView === 'live'}
			<main class="grid live-page" style:--cols={liveTiles <= 1 ? 1 : liveTiles <= 4 ? 2 : 3}>
				{#each data.cameras as camera, i (camera.id)}
					<CameraTile id={camera.id} label={camera.label} refreshMs={5000} paused={night.active || viewer !== null} onopen={() => (viewer = i)} />
				{/each}
				{#if data.cabinConfigured}
					<CabinTile {cabin} />
				{/if}
				{#if liveTiles === 0}
					<Card title="Cameras"><p class="muted">No cameras set up.</p></Card>
				{/if}
			</main>
		{:else}
			<main class="grid cameras-page" class:single={!data.cabinConfigured || !data.protectConfigured}>
				{#if data.cabinConfigured}
					<div class="area cabin">
						<CabinCard {cabin} />
					</div>
				{/if}
				{#if data.protectConfigured}
					<div class="area protect">
						<ProtectCard {protect} />
					</div>
				{:else if !data.cabinConfigured}
					<Card title="Detections"><p class="muted">No camera events set up.</p></Card>
				{/if}
			</main>
		{/if}
	{:else}
		<main class="grid homelab-page">
			<div class="area wan">
				{#if live}<WanCard wan={live.wan} />{:else}<Card title="Internet"><p class="muted">Metrics unavailable.</p></Card>{/if}
			</div>
			<div class="area speed">
				<SpeedtestCard speedtest={slow?.speedtest ?? null} />
			</div>
			<div class="area homelab">
				{#if slow}<HomelabCard homelab={slow.homelab} />{:else}<Card title="Homelab"><p class="muted">Metrics unavailable.</p></Card>{/if}
			</div>
			<div class="area network">
				{#if live}<NetworkCard {live} />{:else}<Card title="Network"><p class="muted">Metrics unavailable.</p></Card>{/if}
			</div>
			<div class="area top">
				<TopDevicesCard top={live?.top ?? []} limit={10} />
			</div>
		</main>
	{/if}
</div>

{#if viewer !== null}
	<CameraViewer cameras={data.cameras} bind:index={viewer} onclose={() => (viewer = null)} />
{/if}

<style>
	.page {
		max-width: 1600px;
		margin: 0 auto;
		display: flex;
		flex-direction: column;
		gap: 12px;
		padding: max(18px, env(safe-area-inset-top)) max(18px, env(safe-area-inset-right))
			max(18px, env(safe-area-inset-bottom)) max(18px, env(safe-area-inset-left));
	}
	.page.dimmed {
		visibility: hidden;
	}
	.grid {
		display: grid;
		gap: 12px;
	}
	/* Live | Detections switch on the Cameras tab, styled like the top bar's tabs. */
	.views {
		align-self: flex-start;
		display: flex;
		padding: 3px;
		border-radius: 999px;
		background: var(--surface);
		border: 1px solid var(--border);
	}
	.views button {
		display: inline-flex;
		align-items: center;
		gap: 7px;
		padding: 7px 16px;
		font-size: 14px;
		font-weight: 600;
		border: 0;
		border-radius: 999px;
		background: transparent;
		color: var(--muted);
		cursor: pointer;
	}
	.views button.active {
		background: rgba(255, 255, 255, 0.14);
		color: var(--text);
	}
	.today {
		min-width: 20px;
		padding: 1px 7px;
		font-size: 12px;
		border-radius: 999px;
		background: rgba(251, 191, 36, 0.18);
		color: var(--warn);
	}
	.wan {
		grid-area: wan;
	}
	.network {
		grid-area: net;
	}
	.speed {
		grid-area: spd;
	}
	.top {
		grid-area: top;
	}
	.homelab {
		grid-area: lab;
	}
	.workout {
		grid-area: wo;
	}
	.calendar {
		grid-area: cal;
	}
	.cabin {
		grid-area: cab;
	}
	.protect {
		grid-area: evt;
	}
	/* Only one of the two camera cards configured: it takes the whole width. */
	.grid.cameras-page.single {
		grid-template-areas: none;
	}
	.cameras-page.single > :global(*) {
		grid-area: auto;
		grid-column: 1 / -1;
	}
	.packages {
		grid-area: pkg;
	}
	.presence {
		grid-area: who;
	}
	.area {
		min-width: 0;
		min-height: 0;
	}
	p {
		margin: 0;
	}

	/* iPad landscape and laptops: exactly one screen. Home: who's home, packages and workouts on the
	   left, the calendar full height on the right. Cameras: the live pictures fill the screen. Homelab:
	   internet, speed test and server on the left, the local network and its busiest devices on the right. */
	@media (min-width: 1000px) and (min-aspect-ratio: 5/4) {
		.page {
			height: 100dvh;
		}
		.grid {
			flex: 1;
			min-height: 0;
			grid-template-columns: repeat(12, minmax(0, 1fr));
		}
		.grid.home-page {
			grid-template-rows: auto minmax(0, 1fr);
			grid-template-areas:
				'who who who who cal cal cal cal cal cal cal cal'
				'pkg pkg pkg pkg cal cal cal cal cal cal cal cal';
		}
		.grid.home-page.with-workout {
			grid-template-rows: auto minmax(0, 3fr) minmax(0, 2fr);
			grid-template-areas:
				'who who who who cal cal cal cal cal cal cal cal'
				'pkg pkg pkg pkg cal cal cal cal cal cal cal cal'
				'wo wo wo wo cal cal cal cal cal cal cal cal';
		}
		.grid.live-page {
			grid-template-columns: repeat(var(--cols), minmax(0, 1fr));
			grid-auto-rows: minmax(0, 1fr);
		}
		.live-page > :global(.tile) {
			aspect-ratio: auto;
			height: 100%;
		}
		.grid.homelab-page {
			grid-template-rows: auto minmax(0, 1fr) minmax(0, 1fr);
			grid-template-areas:
				'wan wan wan wan net net net net net net net net'
				'spd spd spd spd top top top top top top top top'
				'lab lab lab lab top top top top top top top top';
		}
		/* Cameras: the cabin on the left, the home cameras' events on the right; both scroll inside. */
		.grid.cameras-page {
			grid-template-rows: minmax(0, 1fr);
			grid-template-areas: 'cab cab cab cab evt evt evt evt evt evt evt evt';
		}
		/* Size containers: the cards drop details that do not fit their grid slot. */
		.workout {
			container: workout / size;
		}
		.calendar {
			container: calendar / size;
		}
	}

	/* iPad portrait and narrower landscape windows. */
	@media not ((min-width: 1000px) and (min-aspect-ratio: 5/4)) {
		.grid {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
		.grid.home-page {
			grid-template-areas:
				'who who'
				'cal cal'
				'pkg pkg';
		}
		.grid.home-page.with-workout {
			grid-template-areas:
				'who who'
				'cal cal'
				'pkg wo';
		}
		.grid.homelab-page {
			grid-template-areas:
				'wan wan'
				'net net'
				'spd lab'
				'top top';
		}
		.grid.cameras-page {
			grid-template-areas:
				'cab cab'
				'evt evt';
		}
		.wan {
			min-height: 280px;
		}
	}

	/* Phones: one column. */
	@media (max-width: 640px) {
		.page {
			padding-left: max(14px, env(safe-area-inset-left));
			padding-right: max(14px, env(safe-area-inset-right));
		}
		.grid {
			grid-template-columns: minmax(0, 1fr);
		}
		.grid.home-page {
			grid-template-areas: 'who' 'cal' 'pkg';
		}
		.grid.home-page.with-workout {
			grid-template-areas: 'who' 'cal' 'pkg' 'wo';
		}
		.grid.homelab-page {
			grid-template-areas: 'wan' 'net' 'spd' 'lab' 'top';
		}
		.grid.cameras-page {
			grid-template-areas: 'cab' 'evt';
		}
	}
</style>
