<script lang="ts">
	import { fade, fly } from 'svelte/transition';
	import WeatherIcon from './WeatherIcon.svelte';
	import { shortDay } from '$lib/dates';
	import { describeWeather, temperatureColor } from '$lib/weather';
	import type { WeatherData } from '$lib/types';

	let { place, onclose }: { place: WeatherData; onclose: () => void } = $props();

	const condition = $derived(describeWeather(place.current.code));
	// Shared scale for all range bars, so days compare at a glance.
	const scaleMin = $derived(Math.min(...place.days.map((d) => d.min)));
	const scaleMax = $derived(Math.max(...place.days.map((d) => d.max)));
	const span = $derived(Math.max(1, scaleMax - scaleMin));

	function dayLabel(date: string, index: number): string {
		return index === 0 ? 'Tänään' : shortDay(date.slice(0, 10));
	}

	function onkeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') onclose();
	}
</script>

<svelte:window {onkeydown} />

<div class="backdrop" transition:fade={{ duration: 180 }} onclick={(e) => e.target === e.currentTarget && onclose()} role="presentation">
	<div class="panel" transition:fly={{ y: 24, duration: 260 }} role="dialog" aria-modal="true" aria-label="{place.name} 10-day forecast" tabindex="-1">
		<header>
			<div class="title">
				<h2>{place.name}</h2>
				<span class="muted">{condition.label}</span>
			</div>
			<button class="close" onclick={onclose} aria-label="Close">
				<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18" /></svg>
			</button>
		</header>

		<section class="now">
			<WeatherIcon kind={condition.kind} day={place.current.isDay} size={64} />
			<span class="temp num">{Math.round(place.current.temperature)}°</span>
			<dl class="facts num">
				<div><dt>Feels like</dt><dd>{Math.round(place.current.feelsLike)}°</dd></div>
				<div><dt>Wind</dt><dd>{Math.round(place.current.windMs)} m/s</dd></div>
				<div><dt>Humidity</dt><dd>{Math.round(place.current.humidity)}%</dd></div>
				<div><dt>Sun</dt><dd>{place.today.sunrise.slice(11, 16)}–{place.today.sunset.slice(11, 16)}</dd></div>
			</dl>
		</section>

		<ol class="hours" aria-label="Next hours">
			{#each place.hours as hour (hour.time)}
				{@const hhmm = hour.time.slice(11, 16)}
				<li>
					<span class="muted num">{hour.time.slice(11, 13)}</span>
					<WeatherIcon kind={describeWeather(hour.code).kind} size={26} day={hhmm > place.today.sunrise.slice(11, 16) && hhmm < place.today.sunset.slice(11, 16)} />
					<span class="num">{Math.round(hour.temperature)}°</span>
					{#if (hour.precipitationChance ?? 0) >= 20}<span class="rain num">{hour.precipitationChance}%</span>{/if}
				</li>
			{/each}
		</ol>

		<h3>10-day forecast</h3>
		<ol class="days">
			{#each place.days as day, i (day.date)}
				{@const c = describeWeather(day.code)}
				<li>
					<span class="day">{dayLabel(day.date, i)}</span>
					<span class="icon" title={c.label}><WeatherIcon kind={c.kind} size={28} /></span>
					<span class="precip num">
						{#if (day.precipitationChance ?? 0) >= 20 || (day.precipitationMm ?? 0) >= 0.5}
							<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z" /></svg>
							{day.precipitationChance ?? 0}%{#if (day.precipitationMm ?? 0) >= 0.5}<small> {day.precipitationMm?.toFixed(1)} mm</small>{/if}
						{/if}
					</span>
					<span class="low num">{Math.round(day.min)}°</span>
					<span class="range" aria-hidden="true">
						<span
							class="fill"
							style:left="{((day.min - scaleMin) / span) * 100}%"
							style:width="{Math.max(4, ((day.max - day.min) / span) * 100)}%"
							style:background="linear-gradient(90deg, {temperatureColor(day.min)}, {temperatureColor(day.max)})"
						></span>
					</span>
					<span class="high num">{Math.round(day.max)}°</span>
					<span class="wind muted num">{day.windMaxMs === null ? '' : `${Math.round(day.windMaxMs)} m/s`}</span>
				</li>
			{/each}
		</ol>
		<p class="source muted">Forecast by Open-Meteo · updated {new Date(place.updatedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</p>
	</div>
</div>

<style>
	.backdrop {
		position: fixed;
		inset: 0;
		z-index: 50;
		display: grid;
		place-items: center;
		padding: max(16px, env(safe-area-inset-top)) max(16px, env(safe-area-inset-right))
			max(16px, env(safe-area-inset-bottom)) max(16px, env(safe-area-inset-left));
		background: rgba(3, 5, 10, 0.6);
		backdrop-filter: blur(14px);
		-webkit-backdrop-filter: blur(14px);
	}
	.panel {
		width: min(620px, 100%);
		max-height: calc(100dvh - 32px);
		overflow-y: auto;
		overscroll-behavior: contain;
		display: grid;
		gap: 16px;
		padding: 22px 24px 18px;
		background: linear-gradient(180deg, rgba(30, 41, 70, 0.92), rgba(14, 18, 30, 0.95));
		border: 1px solid var(--border);
		border-radius: 28px;
		box-shadow: 0 40px 100px rgba(0, 0, 0, 0.55);
		outline: none;
	}
	header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 12px;
	}
	.title {
		display: grid;
	}
	h2 {
		margin: 0;
		font-size: 26px;
		font-weight: 650;
		letter-spacing: -0.02em;
	}
	.close {
		width: 40px;
		height: 40px;
		flex: none;
		display: grid;
		place-items: center;
		border: 1px solid var(--border);
		border-radius: 50%;
		background: var(--surface-strong);
		cursor: pointer;
	}
	.close svg {
		width: 18px;
		height: 18px;
		fill: none;
		stroke: currentColor;
		stroke-width: 2;
		stroke-linecap: round;
	}
	.now {
		display: flex;
		align-items: center;
		gap: 16px;
	}
	.temp {
		font-size: 64px;
		font-weight: 300;
		line-height: 1;
		letter-spacing: -0.04em;
	}
	.facts {
		margin: 0 0 0 auto;
		display: grid;
		grid-template-columns: auto auto;
		gap: 6px 18px;
		font-size: 14px;
	}
	.facts div {
		display: flex;
		justify-content: space-between;
		gap: 10px;
	}
	dt {
		color: var(--muted);
	}
	dd {
		margin: 0;
		font-weight: 600;
	}
	.hours {
		list-style: none;
		margin: 0;
		padding: 12px 4px;
		display: flex;
		gap: 4px;
		overflow-x: auto;
		scrollbar-width: none;
		border-top: 1px solid var(--border);
		border-bottom: 1px solid var(--border);
	}
	.hours::-webkit-scrollbar {
		display: none;
	}
	.hours li {
		flex: 1 0 44px;
		display: grid;
		justify-items: center;
		align-content: start;
		gap: 5px;
		font-size: 14px;
	}
	.rain {
		font-size: 11px;
		color: var(--down);
	}
	h3 {
		margin: 2px 0 -6px;
		font-size: 12px;
		font-weight: 600;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--muted);
	}
	.days {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
	}
	.days li {
		display: grid;
		grid-template-columns: 96px 34px 96px 34px 1fr 34px 52px;
		align-items: center;
		gap: 8px;
		padding: 8px 0;
		border-bottom: 1px solid rgba(255, 255, 255, 0.05);
		font-size: 15px;
	}
	.days li:last-child {
		border-bottom: 0;
	}
	.day {
		font-weight: 600;
		white-space: nowrap;
	}
	.icon {
		display: grid;
		place-items: center;
	}
	.precip {
		display: inline-flex;
		align-items: center;
		gap: 3px;
		font-size: 13px;
		font-weight: 600;
		color: var(--down);
		white-space: nowrap;
	}
	.precip svg {
		width: 12px;
		height: 12px;
		flex: none;
		fill: currentColor;
	}
	.precip small {
		font-weight: 400;
		color: var(--muted);
	}
	.low {
		text-align: right;
		color: var(--muted);
	}
	.high {
		font-weight: 600;
	}
	.range {
		position: relative;
		height: 6px;
		border-radius: 3px;
		background: rgba(255, 255, 255, 0.08);
	}
	.fill {
		position: absolute;
		top: 0;
		bottom: 0;
		border-radius: 3px;
	}
	.wind {
		font-size: 12px;
		text-align: right;
		white-space: nowrap;
	}
	.source {
		margin: 0;
		font-size: 11px;
		text-align: center;
	}
	/* Phones: drop the wind column and tighten. */
	@media (max-width: 520px) {
		.panel {
			padding: 18px 16px 14px;
		}
		.facts {
			grid-template-columns: auto;
		}
		.days li {
			grid-template-columns: 76px 30px 54px 28px 1fr 28px;
			gap: 6px;
			font-size: 14px;
		}
		.wind,
		.precip small {
			display: none;
		}
	}
</style>
