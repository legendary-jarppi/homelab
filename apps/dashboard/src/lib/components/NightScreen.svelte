<script lang="ts">
	import { fade } from 'svelte/transition';
	import WeatherIcon from './WeatherIcon.svelte';
	import { night } from '$lib/night.svelte';
	import { describeWeather } from '$lib/weather';
	import { longDate } from '$lib/dates';
	import type { WeatherData } from '$lib/types';

	let { weather, ok }: { weather: WeatherData[] | null; ok: boolean } = $props();

	const time = $derived(night.now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }));
	const date = $derived(longDate(night.now));
</script>

<button class="night" transition:fade={{ duration: 600 }} onclick={() => night.peek()} aria-label="Show dashboard">
	<span class="time num">{time}</span>
	<span class="date">{date}</span>
	{#if weather && weather.length > 0}
		<span class="weather num">
			{#each weather as place (place.name)}
				<span class="place">
					<WeatherIcon kind={describeWeather(place.current.code).kind} day={place.current.isDay} size={30} />
					{Math.round(place.current.temperature)}°
					<small>{place.name}</small>
				</span>
			{/each}
		</span>
	{/if}
	<span class="status" class:bad={!ok}><i></i>{ok ? 'All good' : 'Check dashboard'}</span>
	<span class="hint">Tap to show dashboard</span>
</button>

<style>
	.night {
		position: fixed;
		inset: 0;
		z-index: 40;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 10px;
		border: 0;
		background: #000;
		color: #7c8599;
		cursor: pointer;
	}
	.time {
		font-size: clamp(96px, 20vw, 220px);
		font-weight: 200;
		line-height: 1;
		letter-spacing: -0.05em;
		color: #9aa3b5;
	}
	.date {
		font-size: 22px;
	}
	.weather {
		display: inline-flex;
		gap: 36px;
		margin-top: 18px;
		opacity: 0.7;
	}
	.place {
		display: inline-flex;
		align-items: center;
		gap: 10px;
		font-size: 30px;
	}
	.place small {
		font-size: 16px;
	}
	.status {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		margin-top: 26px;
		font-size: 15px;
		color: #3f8f6e;
	}
	.status.bad {
		color: #b45a5a;
	}
	.status i {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: currentColor;
	}
	.hint {
		position: absolute;
		bottom: max(24px, env(safe-area-inset-bottom));
		font-size: 13px;
		color: #3a4050;
	}
</style>
