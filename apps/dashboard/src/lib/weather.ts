export type WeatherKind = 'clear' | 'partly' | 'cloudy' | 'fog' | 'drizzle' | 'rain' | 'snow' | 'thunder';

/** WMO weather interpretation codes (Open-Meteo `weather_code`) -> icon kind and label. */
export function describeWeather(code: number): { kind: WeatherKind; label: string } {
	if (code === 0) return { kind: 'clear', label: 'Clear' };
	if (code === 1) return { kind: 'partly', label: 'Mostly clear' };
	if (code === 2) return { kind: 'partly', label: 'Partly cloudy' };
	if (code === 3) return { kind: 'cloudy', label: 'Overcast' };
	if (code === 45 || code === 48) return { kind: 'fog', label: 'Fog' };
	if (code >= 51 && code <= 57) return { kind: 'drizzle', label: 'Drizzle' };
	if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) {
		return { kind: 'rain', label: code === 65 || code === 82 ? 'Heavy rain' : code >= 80 ? 'Showers' : 'Rain' };
	}
	if ((code >= 71 && code <= 77) || code === 85 || code === 86) return { kind: 'snow', label: 'Snow' };
	if (code >= 95) return { kind: 'thunder', label: 'Thunderstorm' };
	return { kind: 'cloudy', label: 'Cloudy' };
}

/** °C -> color stops for temperature-range bars (cold blue … hot red). */
const TEMPERATURE_STOPS: [number, [number, number, number]][] = [
	[-20, [165, 180, 252]],
	[-10, [96, 165, 250]],
	[0, [34, 211, 238]],
	[10, [52, 211, 153]],
	[17, [250, 204, 21]],
	[24, [251, 146, 60]],
	[30, [248, 113, 113]]
];

export function temperatureColor(celsius: number): string {
	const stops = TEMPERATURE_STOPS;
	if (celsius <= stops[0][0]) return `rgb(${stops[0][1].join(',')})`;
	for (let i = 1; i < stops.length; i++) {
		const [t1, c1] = stops[i];
		if (celsius <= t1) {
			const [t0, c0] = stops[i - 1];
			const f = (celsius - t0) / (t1 - t0);
			return `rgb(${c0.map((v, k) => Math.round(v + (c1[k] - v) * f)).join(',')})`;
		}
	}
	return `rgb(${stops[stops.length - 1][1].join(',')})`;
}
