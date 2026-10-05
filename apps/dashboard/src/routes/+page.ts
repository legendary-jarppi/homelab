import type { CalendarData, LiveData, PackagesData, SlowData, WeatherData, WorkoutSummary } from '$lib/types';
import type { PageLoad } from './$types';

/** First render with data already in place; the page polls afterwards. Failures render as empty cards. */
export const load: PageLoad = async ({ data, fetch }) => {
	const get = async <T>(url: string): Promise<T | null> => {
		try {
			const response = await fetch(url);
			if (response.ok) return (await response.json()) as T;
			console.error(`initial load ${url}: HTTP ${response.status}`);
		} catch (e) {
			console.error(`initial load ${url}:`, e);
		}
		return null;
	};
	const [live, slow, weather, workout, calendar, packages] = await Promise.all([
		get<LiveData>('/api/live'),
		get<SlowData>('/api/slow'),
		data.weatherConfigured ? get<WeatherData[]>('/api/weather') : null,
		data.workoutConfigured ? get<WorkoutSummary>('/api/workout') : null,
		data.calendarConfigured ? get<CalendarData>('/api/calendar') : null,
		get<PackagesData>('/api/packages')
	]);
	return { ...data, live, slow, weather, workout, calendar, packages };
};
