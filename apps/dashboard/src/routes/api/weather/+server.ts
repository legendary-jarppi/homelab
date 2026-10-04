import { error, json } from '@sveltejs/kit';
import { config } from '$lib/server/config';
import type { WeatherData } from '$lib/types';
import type { RequestHandler } from './$types';

const CACHE_MS = 10 * 60 * 1000;
let cached: { locations: WeatherData[]; at: number } | null = null;

/** One Open-Meteo request for all configured locations; array in configuration order. */
export const GET: RequestHandler = async () => {
	const locations = config.weatherLocations;
	if (locations.length === 0) error(404, 'Weather locations not configured');

	if (!cached || Date.now() - cached.at > CACHE_MS) {
		const url = new URL('https://api.open-meteo.com/v1/forecast');
		url.search = new URLSearchParams({
			latitude: locations.map((l) => l.latitude).join(','),
			longitude: locations.map((l) => l.longitude).join(','),
			current: 'temperature_2m,apparent_temperature,weather_code,is_day,wind_speed_10m,relative_humidity_2m',
			hourly: 'temperature_2m,weather_code,precipitation_probability',
			daily:
				'weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,precipitation_probability_max,precipitation_sum,wind_speed_10m_max',
			wind_speed_unit: 'ms',
			timezone: 'auto',
			forecast_days: '10'
		}).toString();
		const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
		if (!response.ok) error(502, `Open-Meteo: ${response.status}`);
		const body = await response.json();
		// A single location comes back as an object, several as an array.
		const results = Array.isArray(body) ? body : [body];
		const now = Date.now();

		cached = {
			at: now,
			locations: results.map((w, index): WeatherData => {
				// Next 12 hours starting from the current hour (hourly times are local, "YYYY-MM-DDTHH:00").
				const nowHour = (w.current.time as string).slice(0, 13);
				const start = Math.max(0, (w.hourly.time as string[]).findIndex((t) => t.slice(0, 13) === nowHour));
				return {
					name: locations[index].name,
					current: {
						temperature: w.current.temperature_2m,
						feelsLike: w.current.apparent_temperature,
						code: w.current.weather_code,
						isDay: w.current.is_day === 1,
						windMs: w.current.wind_speed_10m,
						humidity: w.current.relative_humidity_2m
					},
					today: {
						max: w.daily.temperature_2m_max[0],
						min: w.daily.temperature_2m_min[0],
						sunrise: w.daily.sunrise[0],
						sunset: w.daily.sunset[0],
						precipitationChance: w.daily.precipitation_probability_max[0] ?? null
					},
					hours: (w.hourly.time as string[]).slice(start + 1, start + 13).map((time, i) => ({
						time,
						temperature: w.hourly.temperature_2m[start + 1 + i],
						code: w.hourly.weather_code[start + 1 + i],
						precipitationChance: w.hourly.precipitation_probability[start + 1 + i] ?? null
					})),
					days: (w.daily.time as string[]).map((date, i) => ({
						date,
						code: w.daily.weather_code[i],
						max: w.daily.temperature_2m_max[i],
						min: w.daily.temperature_2m_min[i],
						precipitationChance: w.daily.precipitation_probability_max[i] ?? null,
						precipitationMm: w.daily.precipitation_sum[i] ?? null,
						windMaxMs: w.daily.wind_speed_10m_max[i] ?? null
					})),
					updatedAt: now
				};
			})
		};
	}
	return json(cached.locations, { headers: { 'Cache-Control': 'no-store' } });
};
