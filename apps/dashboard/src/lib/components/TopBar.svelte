<script lang="ts">
	import { fade } from 'svelte/transition';
	import WeatherIcon from './WeatherIcon.svelte';
	import { night, type NightMode } from '$lib/night.svelte';
	import { describeWeather } from '$lib/weather';
	import type { LiveData, WeatherData } from '$lib/types';

	let {
		weather,
		weatherConfigured,
		live,
		liveStale
	}: { weather: WeatherData | null; weatherConfigured: boolean; live: LiveData | null; liveStale: boolean } = $props();

	const time = $derived(night.now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }));
	const date = $derived(night.now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }));
	const condition = $derived(weather ? describeWeather(weather.current.code) : null);
	const NIGHT_OPTIONS: { mode: NightMode; label: string }[] = [
		{ mode: 'auto', label: 'Auto' },
		{ mode: 'on', label: 'On' },
		{ mode: 'off', label: 'Off' }
	];

	let menuOpen = $state(false);
	let menu: HTMLDivElement;

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

	{#if weather && condition}
		<div class="weather">
			<WeatherIcon kind={condition.kind} day={weather.current.isDay} size={50} />
			<div class="now">
				<span class="temp num">{Math.round(weather.current.temperature)}°</span>
				<span class="desc">
					<span>{condition.label}{weather.name ? ` · ${weather.name}` : ''}</span>
					<span class="muted num">
						H {Math.round(weather.today.max)}° L {Math.round(weather.today.min)}° · {Math.round(weather.current.windMs)} m/s
					</span>
				</span>
			</div>
			<ol class="hours">
				{#each weather.hours.slice(0, 6) as hour (hour.time)}
					{@const h = describeWeather(hour.code)}
					{@const hhmm = hour.time.slice(11, 16)}
					<li>
						<span class="muted num">{hour.time.slice(11, 13)}</span>
						<WeatherIcon kind={h.kind} size={22} day={hhmm > weather.today.sunrise.slice(11, 16) && hhmm < weather.today.sunset.slice(11, 16)} />
						<span class="num">{Math.round(hour.temperature)}°</span>
					</li>
				{/each}
			</ol>
		</div>
	{:else if !weatherConfigured}
		<div class="weather muted">Weather location not set</div>
	{:else}
		<div class="weather"></div>
	{/if}

	<div class="controls">
		<span class="pill" class:bad={liveStale || !live}>
			<i></i>{liveStale || !live ? 'No data' : live.wan.latencyMs !== null ? `Online · ${live.wan.latencyMs < 1 ? '<1' : Math.round(live.wan.latencyMs)} ms` : 'Online'}
		</span>
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
		gap: 12px;
	}
	.now {
		display: flex;
		align-items: center;
		gap: 10px;
		min-width: 0;
	}
	.temp {
		font-size: 42px;
		font-weight: 600;
		letter-spacing: -0.03em;
	}
	.desc {
		display: grid;
		font-size: 15px;
		font-weight: 550;
		min-width: 0;
		white-space: nowrap;
	}
	.desc .muted {
		font-size: 13px;
		font-weight: 400;
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
		gap: 10px;
		flex: none;
	}
	.pill {
		display: inline-flex;
		align-items: center;
		gap: 7px;
		padding: 8px 13px;
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
	/* Hourly strip only where it fits beside the clock and controls. */
	@media (max-width: 1060px) {
		.hours {
			display: none;
		}
	}
	@media (max-width: 760px) {
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
</style>
