<script lang="ts">
	import { fade } from 'svelte/transition';
	import WeatherForecast from './WeatherForecast.svelte';
	import WeatherIcon from './WeatherIcon.svelte';
	import { night, type NightMode } from '$lib/night.svelte';
	import { describeWeather } from '$lib/weather';
	import { backupProblem } from '$lib/backup';
	import { longDate } from '$lib/dates';
	import type { DashboardTab, LiveData, SlowData, WeatherData } from '$lib/types';

	let {
		weather,
		weatherConfigured,
		live,
		liveStale,
		backup,
		tab = $bindable()
	}: {
		weather: WeatherData[] | null;
		weatherConfigured: boolean;
		live: LiveData | null;
		liveStale: boolean;
		/** null while the status is unknown (no data from Prometheus yet). */
		backup: SlowData['homelab']['backup'] | null;
		tab: DashboardTab;
	} = $props();

	const backupIssue = $derived(backup ? backupProblem(backup, night.now.getTime()) : null);

	const TABS: { id: DashboardTab; label: string }[] = [
		{ id: 'home', label: 'Home' },
		{ id: 'homelab', label: 'Homelab' }
	];
	const time = $derived(night.now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }));
	const date = $derived(longDate(night.now));
	const NIGHT_OPTIONS: { mode: NightMode; label: string }[] = [
		{ mode: 'auto', label: 'Auto' },
		{ mode: 'on', label: 'On' },
		{ mode: 'off', label: 'Off' }
	];

	let menuOpen = $state(false);
	let menu: HTMLDivElement;
	/** Index into `weather` of the location whose forecast popup is open. */
	let forecast = $state<number | null>(null);

	function onWindowClick(event: MouseEvent) {
		if (menuOpen && !menu.contains(event.target as Node)) menuOpen = false;
	}
</script>

<svelte:window onclick={onWindowClick} />

<header class="bar">
	<div class="clock">
		<span class="time num">{time}</span>
		<span class="date">{date}</span>
	</div>

	{#if weather && weather.length > 0}
		{@const primary = weather[0]}
		<div class="weather">
			{#each weather as place, i (place.name)}
				{@const c = describeWeather(place.current.code)}
				<button class="place" class:secondary={i > 0} onclick={() => (forecast = i)} aria-label="{place.name}: 10-day forecast">
					<WeatherIcon kind={c.kind} day={place.current.isDay} size={i === 0 ? 46 : 38} />
					<span class="temp num">{Math.round(place.current.temperature)}°</span>
					<span class="desc">
						<span class="name">{place.name}</span>
						<span class="muted num">{c.label} · H {Math.round(place.today.max)}° L {Math.round(place.today.min)}°</span>
					</span>
				</button>
			{/each}
			<ol class="hours" aria-label="{primary.name} next hours">
				{#each primary.hours.slice(0, 6) as hour (hour.time)}
					{@const h = describeWeather(hour.code)}
					{@const hhmm = hour.time.slice(11, 16)}
					<li>
						<span class="muted num">{hour.time.slice(11, 13)}</span>
						<WeatherIcon kind={h.kind} size={22} day={hhmm > primary.today.sunrise.slice(11, 16) && hhmm < primary.today.sunset.slice(11, 16)} />
						<span class="num">{Math.round(hour.temperature)}°</span>
					</li>
				{/each}
			</ol>
		</div>
	{:else if !weatherConfigured}
		<div class="weather muted">Weather locations not set</div>
	{:else}
		<div class="weather"></div>
	{/if}

	<div class="controls">
		<div class="tabs" role="tablist" aria-label="Dashboard page">
			{#each TABS as t (t.id)}
				<button role="tab" aria-selected={tab === t.id} class:active={tab === t.id} onclick={() => (tab = t.id)}>{t.label}</button>
			{/each}
		</div>
		<span class="pill" class:bad={liveStale || !live}>
			<i></i><span>{#if liveStale || !live}No data{:else}Online{#if live.wan.latencyMs !== null}<span class="latency">{` · ${live.wan.latencyMs < 1 ? '<1' : Math.round(live.wan.latencyMs)} ms`}</span>{/if}{/if}</span>
		</span>
		{#if backup}
			<button class="pill backup" class:warn={backupIssue !== null} onclick={() => (tab = 'homelab')} aria-label="{backupIssue?.detail ?? 'Backup ok'}: open Homelab">
				<i></i><span class="label">{backupIssue?.short ?? 'Backup ok'}</span>
			</button>
		{/if}
		<div class="menu" bind:this={menu}>
			<button class="icon" onclick={() => (menuOpen = !menuOpen)} aria-label="Menu" aria-expanded={menuOpen}>
				<svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="19" cy="12" r="1.6" /></svg>
			</button>
			{#if menuOpen}
				<div class="popover" transition:fade={{ duration: 120 }}>
					<span class="heading">Night mode</span>
					<div class="segmented" role="radiogroup" aria-label="Night mode">
						{#each NIGHT_OPTIONS as option (option.mode)}
							<button role="radio" aria-checked={night.mode === option.mode} class:active={night.mode === option.mode} onclick={() => night.set(option.mode)}>
								{option.label}
							</button>
						{/each}
					</div>
					<span class="hint muted">Auto dims the screen 22:00–06:30.</span>
					<form method="POST" action="/logout">
						<button class="logout">Log out this device</button>
					</form>
				</div>
			{/if}
		</div>
	</div>
</header>

{#if forecast !== null && weather?.[forecast]}
	<WeatherForecast place={weather[forecast]} onclose={() => (forecast = null)} />
{/if}

<style>
	.bar {
		display: flex;
		align-items: center;
		gap: 26px;
		padding: 2px 4px 0;
	}
	.clock {
		display: grid;
		flex: none;
	}
	.time {
		font-size: clamp(46px, 5.6vw, 72px);
		font-weight: 600;
		line-height: 1;
		letter-spacing: -0.04em;
	}
	.date {
		margin-top: 4px;
		font-size: 15px;
		color: var(--muted);
	}
	.weather {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: center;
		gap: 18px;
	}
	.place {
		display: flex;
		align-items: center;
		gap: 9px;
		min-width: 0;
		padding: 4px 10px;
		margin: -4px 0;
		border: 0;
		border-radius: 16px;
		background: transparent;
		text-align: left;
		cursor: pointer;
		transition: background 0.2s, transform 0.1s;
	}
	.place:active {
		transform: scale(0.98);
		background: var(--surface-strong);
	}
	@media (hover: hover) {
		.place:hover {
			background: var(--surface);
		}
	}
	.place.secondary {
		position: relative;
	}
	/* Divider between locations. */
	.place.secondary::before {
		content: '';
		position: absolute;
		left: -9px;
		top: 10%;
		bottom: 10%;
		border-left: 1px solid var(--border);
	}
	.temp {
		font-size: 40px;
		font-weight: 600;
		letter-spacing: -0.03em;
	}
	.secondary .temp {
		font-size: 32px;
	}
	.desc {
		display: grid;
		min-width: 0;
		white-space: nowrap;
	}
	.name {
		font-size: 15px;
		font-weight: 600;
	}
	.desc .muted {
		font-size: 13px;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.hours {
		list-style: none;
		margin: 0 0 0 auto;
		padding: 0 4px 0 0;
		display: flex;
		gap: 12px;
	}
	.hours li {
		display: grid;
		justify-items: center;
		gap: 3px;
		font-size: 13px;
	}
	.controls {
		display: flex;
		align-items: center;
		gap: 6px;
		flex: none;
	}
	.tabs {
		display: flex;
		padding: 3px;
		border-radius: 999px;
		background: var(--surface);
		border: 1px solid var(--border);
	}
	.tabs button {
		padding: 7px 14px;
		font-size: 13px;
		font-weight: 600;
		border: 0;
		border-radius: 999px;
		background: transparent;
		color: var(--muted);
		cursor: pointer;
	}
	.tabs button.active {
		background: rgba(255, 255, 255, 0.14);
		color: var(--text);
	}
	.pill {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 8px 12px;
		font-size: 13px;
		font-weight: 600;
		white-space: nowrap;
		border-radius: 999px;
		color: var(--ok);
		background: rgba(52, 211, 153, 0.1);
		border: 1px solid rgba(52, 211, 153, 0.2);
	}
	.pill i {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: currentColor;
		box-shadow: 0 0 8px currentColor;
	}
	.pill.bad {
		color: var(--bad);
		background: rgba(248, 113, 113, 0.1);
		border-color: rgba(248, 113, 113, 0.2);
	}
	.pill.backup {
		font: inherit;
		font-size: 13px;
		font-weight: 600;
		cursor: pointer;
	}
	.pill.warn {
		color: var(--warn);
		background: rgba(251, 191, 36, 0.1);
		border-color: rgba(251, 191, 36, 0.25);
	}
	.menu {
		position: relative;
	}
	.icon {
		width: 40px;
		height: 40px;
		display: grid;
		place-items: center;
		color: var(--muted);
		border: 1px solid var(--border);
		border-radius: 50%;
		background: var(--surface);
		cursor: pointer;
	}
	.icon svg {
		width: 18px;
		height: 18px;
		fill: currentColor;
	}
	.popover {
		position: absolute;
		right: 0;
		top: calc(100% + 8px);
		z-index: 30;
		width: 240px;
		display: grid;
		gap: 10px;
		padding: 14px;
		background: rgba(18, 22, 34, 0.92);
		border: 1px solid var(--border);
		border-radius: 18px;
		backdrop-filter: blur(24px);
		-webkit-backdrop-filter: blur(24px);
		box-shadow: 0 24px 60px rgba(0, 0, 0, 0.5);
	}
	.heading {
		font-size: 12px;
		font-weight: 600;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--muted);
	}
	.segmented {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		padding: 3px;
		border-radius: 12px;
		background: rgba(255, 255, 255, 0.06);
	}
	.segmented button {
		padding: 8px 0;
		font-size: 14px;
		font-weight: 600;
		border: 0;
		border-radius: 9px;
		background: transparent;
		color: var(--muted);
		cursor: pointer;
	}
	.segmented button.active {
		background: rgba(255, 255, 255, 0.14);
		color: var(--text);
	}
	.hint {
		font-size: 12px;
	}
	form {
		margin: 0;
	}
	.logout {
		width: 100%;
		padding: 10px;
		font-size: 14px;
		font-weight: 600;
		border: 1px solid rgba(248, 113, 113, 0.25);
		border-radius: 12px;
		background: rgba(248, 113, 113, 0.08);
		color: var(--bad);
		cursor: pointer;
	}
	/* Hourly strip and latency (also on the Homelab tab's internet card) only where they fit beside
	   both locations, the clock and the controls (measured with both status pills). */
	@media (max-width: 1479px) {
		.latency {
			display: none;
		}
	}
	@media (max-width: 1429px) {
		.hours {
			display: none;
		}
	}
	/* Weather gets its own row under the clock. */
	@media (max-width: 1000px) {
		.bar {
			flex-wrap: wrap;
			gap: 12px 18px;
		}
		.controls {
			margin-left: auto;
		}
		.weather {
			order: 3;
			flex-basis: 100%;
		}
	}
	/* Phones: drop the condition line, keep name + temperature; the backup pill keeps only its dot. */
	@media (max-width: 480px) {
		.desc .muted {
			display: none;
		}
		.pill.backup {
			padding: 8px 11px;
		}
		.pill.backup .label {
			display: none;
		}
		.temp,
		.secondary .temp {
			font-size: 30px;
		}
	}
</style>
