import { config } from '$lib/server/config';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = () => ({
	cameras: config.cameras,
	weatherConfigured: config.weatherLocations.length > 0,
	workoutConfigured: config.workoutToken !== '',
	workoutAppUrl: config.workoutAppUrl,
	calendarConfigured: config.calendarIcsUrl !== ''
});
