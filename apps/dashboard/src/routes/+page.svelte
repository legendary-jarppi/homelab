<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { afterNavigate, replaceState } from '$app/navigation';
	import { page } from '$app/state';
	import CabinCard from '$lib/components/CabinCard.svelte';
	import CabinTile from '$lib/components/CabinTile.svelte';
	import CalendarCard from '$lib/components/CalendarCard.svelte';
	import CameraTile from '$lib/components/CameraTile.svelte';
	import CameraViewer from '$lib/components/CameraViewer.svelte';
	import Card from '$lib/components/Card.svelte';
	import ClimateCard from '$lib/components/ClimateCard.svelte';
	import FilmstripCard from '$lib/components/FilmstripCard.svelte';
	import GuidingCard from '$lib/components/GuidingCard.svelte';
	import LatestFrameCard from '$lib/components/LatestFrameCard.svelte';
	import ListCard from '$lib/components/ListCard.svelte';
	import HomelabCard from '$lib/components/HomelabCard.svelte';
	import NetworkCard from '$lib/components/NetworkCard.svelte';
	import NightScreen from '$lib/components/NightScreen.svelte';
	import PackagesCard from '$lib/components/PackagesCard.svelte';
	import SkyQualityCard from '$lib/components/SkyQualityCard.svelte';
	import PresenceCard from '$lib/components/PresenceCard.svelte';
	import ProtectCard from '$lib/components/ProtectCard.svelte';
	import SpeedtestCard from '$lib/components/SpeedtestCard.svelte';
	import TelescopeSessionCard from '$lib/components/TelescopeSessionCard.svelte';
	import TelescopeViewer from '$lib/components/TelescopeViewer.svelte';
	import TonightCard from '$lib/components/TonightCard.svelte';
	import TopBar, { TABS } from '$lib/components/TopBar.svelte';
	import TopDevicesCard from '$lib/components/TopDevicesCard.svelte';
	import WanCard from '$lib/components/WanCard.svelte';
	import ViewSwitch from '$lib/components/ViewSwitch.svelte';
	import WorkoutCard from '$lib/components/WorkoutCard.svelte';
	import { backupProblem } from '$lib/backup';
	import { cabinEvents } from '$lib/cabin';
	import { dayOf } from '$lib/dates';
	import { night } from '$lib/night.svelte';
	import type {
		CabinData,
		CalendarData,
		ClimateData,
		DashboardTab,
		ListsData,
		LiveData,
		PackagesData,
		PresenceData,
		ProtectData,
		SlowData,
		TelescopeData,
		TonightData,
		WeatherData,
		WorkoutSummary
	} from '$lib/types';

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
	let lists = $state<ListsData | null>(untrack(() => data.lists));
	/** Fetched after the page loads (the heat pumps answer over the VPN). */
	let climate = $state<ClimateData | null>(null);
	/** The cabin's Protect events, fetched after the page loads (over the VPN). */
	let cabinProtect = $state<ProtectData | null>(null);
	/** Fetched after the page loads, then only while the Telescope tab is open. */
	let telescope = $state<TelescopeData | null>(null);
	let tonight = $state<TonightData | null>(null);
	/** Unix ms of the first failed telescope refresh in a row; null while it answers. */
	let telescopeFailedSince = $state<number | null>(null);
	let viewer = $state<number | null>(null);
	/** Index into the telescope's frames shown full screen. */
	let frameViewer = $state<number | null>(null);
	/** `?tab=telescope` (notifications link there) opens that page; the parameter is dropped once the page runs. */
	let tab = $state<DashboardTab>(untrack(() => TABS.find((t) => t.id === page.url.searchParams.get('tab'))?.id ?? 'home'));
	/** The Cameras tab's view; opening the tab always starts on the live pictures. */
	let cameraView = $state<'live' | 'detections'>('live');
	$effect(() => {
		if (tab !== 'cameras') cameraView = 'live';
	});
	const todayKey = $derived(dayOf(night.now.toISOString()));
	/** Motion events today from the home cameras and the cabin's, shown on the Detections switch. */
	const motionToday = $derived(
		[protect, cabinProtect].reduce((n, p) => n + (p?.events.filter((e) => dayOf(new Date(e.start).toISOString()) === todayKey).length ?? 0), 0) +
			(cabin ? cabinEvents(cabin.snapshots).filter((e) => dayOf(new Date(e.time).toISOString()) === todayKey).length : 0)
	);
	const liveTiles = $derived(data.cameras.length + (data.cabinConfigured ? 1 : 0));
	/** Detections in landscape: one column per configured card (cabin 4G camera, cabin Protect, home Protect). */
	const detectionCols = $derived(
		[data.cabinConfigured && 3, data.cabinProtectConfigured && 5, data.protectConfigured && 4]
			.filter(Boolean)
			.map((fr) => `minmax(0, ${fr}fr)`)
			.join(' ')
	);

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
	async function refreshCalendar() {
		const response = await fetch('/api/calendar', { cache: 'no-store' });
		if (response.ok) calendar = await response.json();
	}
	// Drop `?tab=` once it has opened its page, so a reload starts at Home again. The router counts as
	// started only after the first afterNavigate callbacks return, hence the microtask.
	afterNavigate(() => {
		if (!page.url.searchParams.has('tab')) return;
		const url = new URL(page.url);
		url.searchParams.delete('tab');
		queueMicrotask(() => replaceState(url, page.state));
	});
	onMount(() => {
		const stopNight = night.start();
		const RETRY_MS = 30_000;
		const start = Date.now();
		// `due`: next fetch time. Data missing from the server render is fetched right away. `onlyWhile`:
		// after the first fetch, refreshed only while it returns true. `fail`: called when a fetch fails.
		const pollers: {
			url: string;
			everyMs: number;
			apply: (body: unknown) => void;
			due: number;
			onlyWhile?: () => boolean;
			fail?: () => void;
		}[] = [
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
		if (data.listsConfigured) {
			pollers.push({ url: '/api/lists', everyMs: 60_000, apply: (b) => (lists = b as ListsData), due: lists ? start + 60_000 : 0 });
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
			pollers.push({ url: '/api/protect/home', everyMs: 30_000, apply: (b) => (protect = b as ProtectData), due: protect ? start + 30_000 : 0 });
		}
		if (data.cabinProtectConfigured) {
			pollers.push({ url: '/api/protect/cabin', everyMs: 30_000, apply: (b) => (cabinProtect = b as ProtectData), due: 0 });
		}
		if (data.climateConfigured) {
			pollers.push({ url: '/api/climate', everyMs: 60_000, apply: (b) => (climate = b as ClimateData), due: 0 });
		}
		if (data.telescopeConfigured) {
			pollers.push({
				url: '/api/telescope',
				everyMs: 30_000,
				apply: (b) => {
					telescope = b as TelescopeData;
					telescopeFailedSince = null;
				},
				due: 0,
				onlyWhile: () => tab === 'telescope',
				fail: () => (telescopeFailedSince ??= Date.now())
			});
		}
		if (data.telescopeSiteConfigured) {
			pollers.push({ url: '/api/tonight', everyMs: 10 * 60_000, apply: (b) => (tonight = b as TonightData), due: 0, onlyWhile: () => tab === 'telescope' });
		}

		const tick = async (force = false) => {
			if (document.visibilityState !== 'visible') return;
			const now = Date.now();
			await Promise.all(
				pollers
					.filter((p) => (force || now >= p.due) && (p.due === 0 || !p.onlyWhile || p.onlyWhile()))
					.map(async (p) => {
						// Pending until this fetch settles; a failure retries sooner than the regular interval.
						p.due = now + p.everyMs;
						try {
							const response = await fetch(p.url, { cache: 'no-store' });
							if (!response.ok) throw new Error(String(response.status));
							p.apply(await response.json());
						} catch {
							// Keep showing the last data; staleness is surfaced in the top bar.
							p.due = now + Math.min(RETRY_MS, p.everyMs);
							p.fail?.();
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
			<!-- The calendar, with the lists marked "Show on dashboard" (apps/lists) below it. -->
			<div class="area middle">
				<div class="calendar">
					<CalendarCard {calendar} configured={data.calendarConfigured} onchange={refreshCalendar} />
				</div>
				{#if lists && lists.lists.length > 0}
					<div class="lists">
						{#each lists.lists as list (list.slug)}
							<ListCard {list} people={lists.people} appUrl={data.listsAppUrl} />
						{/each}
					</div>
				{/if}
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
		<ViewSwitch
			label="Cameras view"
			bind:value={cameraView}
			options={[
				{ id: 'live', label: 'Live' },
				{ id: 'detections', label: 'Detections', count: motionToday }
			]}
		/>
		{#if cameraView === 'live'}
			<main class="grid live-page" style:--cols={liveTiles <= 1 ? 1 : liveTiles <= 4 ? 2 : liveTiles <= 9 ? 3 : 4}>
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
			<main class="grid cameras-page" style:--detection-cols={detectionCols}>
				{#if data.cabinConfigured}
					<div class="area">
						<CabinCard {cabin} />
					</div>
				{/if}
				{#if data.cabinProtectConfigured}
					<div class="area">
						<ProtectCard title="Cabin cameras" protect={cabinProtect} />
					</div>
				{/if}
				{#if data.protectConfigured}
					<div class="area">
						<ProtectCard title="Home cameras" {protect} />
					</div>
				{/if}
				{#if !detectionCols}
					<Card title="Detections"><p class="muted">No camera events set up.</p></Card>
				{/if}
			</main>
		{/if}
	{:else if tab === 'cabin'}
		<main class="grid cabin-page">
			<ClimateCard {climate} configured={data.climateConfigured} onchange={(next) => (climate = next)} />
		</main>
	{:else if tab === 'telescope'}
		<!-- The telescope web app (home network and VPN only; not through dashboard.shillyshally.org). -->
		<a class="homelab-link" href="http://telescope.lab.internal" target="_blank" rel="noopener">
			Open telescope app
			<span class="muted">telescope.lab.internal ↗</span>
		</a>
		<main class="grid telescope-page">
			<div class="area frame">
				<LatestFrameCard {telescope} configured={data.telescopeConfigured} onopen={(i) => (frameViewer = i)} />
			</div>
			<div class="area session">
				<TelescopeSessionCard {telescope} configured={data.telescopeConfigured} failedSince={telescopeFailedSince} />
			</div>
			<div class="area guiding">
				<GuidingCard {telescope} />
			</div>
			<div class="area sky">
				<SkyQualityCard {telescope} />
			</div>
			<div class="area tonight">
				<TonightCard {tonight} configured={data.telescopeSiteConfigured} />
			</div>
			<div class="area film">
				<FilmstripCard frames={telescope?.frames ?? null} onopen={(i) => (frameViewer = i)} />
			</div>
		</main>
	{:else}
		<a class="homelab-link" href={data.homelabAppUrl} target="_blank" rel="noopener">
			Components, network and devices
			<span class="muted">{data.homelabAppUrl.replace(/^https?:\/\//, '')} ↗</span>
		</a>
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

{#if frameViewer !== null && telescope && telescope.frames.length > 0}
	<TelescopeViewer frames={telescope.frames} plan={telescope.plan} bind:index={frameViewer} onclose={() => (frameViewer = null)} />
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
	/* Homelab: the diagrams and device list live in apps/homelab; a pill like the view switches links there. */
	.homelab-link {
		align-self: flex-start;
		display: inline-flex;
		align-items: baseline;
		flex-wrap: wrap;
		gap: 4px 10px;
		padding: 9px 16px;
		font-size: 14px;
		font-weight: 600;
		border-radius: 999px;
		background: var(--surface);
		border: 1px solid var(--border);
		color: var(--text);
		text-decoration: none;
	}
	.homelab-link .muted {
		font-size: 13px;
		font-weight: 500;
		color: var(--down);
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
	.middle {
		grid-area: cal;
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.lists {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
		gap: 12px;
	}
	/* Detections: the cards one below the other, each across the whole width. */
	.cameras-page > :global(*) {
		grid-column: 1 / -1;
	}
	/* Cabin: the climate card across the whole width (its two devices side by side when they fit). */
	.grid.cabin-page {
		grid-template-columns: minmax(0, 1fr);
		grid-template-areas: none;
	}
	.frame {
		grid-area: img;
	}
	.session {
		grid-area: ses;
	}
	.sky {
		grid-area: sky;
	}
	.tonight {
		grid-area: ton;
	}
	.guiding {
		grid-area: gui;
	}
	.film {
		grid-area: fil;
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
		/* Cameras: the cabin's 4G camera, the cabin's Protect cameras and the home cameras side by side
		   (only those configured); each scrolls inside. */
		.grid.cameras-page {
			grid-template-rows: minmax(0, 1fr);
			grid-template-columns: var(--detection-cols, minmax(0, 1fr));
		}
		.cameras-page > :global(*) {
			grid-column: auto;
		}
		/* Telescope: the latest frame on the left, the session above the guiding in the middle, tonight's sky
		   on the right, the recent frames and the sky quality along the bottom. */
		.grid.telescope-page {
			grid-template-rows: minmax(0, 1fr) auto auto;
			grid-template-areas:
				'img img img img ses ses ses ses ton ton ton ton'
				'img img img img gui gui gui gui ton ton ton ton'
				'fil fil fil fil fil fil fil fil sky sky sky sky';
		}
		/* Size containers: the cards drop details that do not fit their grid slot. */
		.workout {
			container: workout / size;
		}
		.frame {
			container: telescope-frame / size;
		}
		/* The calendar keeps three fifths of the column when list cards are below it. */
		.middle .calendar {
			flex: 3 1 0;
			min-height: 0;
			container: calendar / size;
		}
		.middle .lists {
			flex: 2 1 0;
			min-height: 0;
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
		.grid.telescope-page {
			grid-template-areas:
				'img img'
				'fil fil'
				'ses ton'
				'gui ton'
				'sky ton';
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
		.grid.telescope-page {
			grid-template-areas: 'img' 'fil' 'ses' 'gui' 'sky' 'ton';
		}
	}
</style>
