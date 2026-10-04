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
