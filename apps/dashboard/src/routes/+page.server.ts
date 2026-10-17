import { calendarConfigured } from '$lib/server/calendar';
import { config } from '$lib/server/config';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = () => ({
	cameras: config.cameras,
	weatherConfigured: config.weatherLocations.length > 0,
	workoutConfigured: config.workoutToken !== '',
	workoutAppUrl: config.workoutAppUrl,
	calendarConfigured: calendarConfigured(),
	presenceConfigured: config.presenceUrl !== '',
	cabinConfigured: config.cabinCameraUrl !== '',
	climateConfigured: config.climateUrl !== '',
	protectConfigured: config.protectUser !== '' && config.protectPass !== '',
	listsConfigured: config.listsToken !== '',
	listsAppUrl: config.listsAppUrl
});
