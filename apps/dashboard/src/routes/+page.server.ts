import { calendarConfigured } from '$lib/server/calendar';
import { config } from '$lib/server/config';
import { linkedCamera } from '$lib/server/protect';
import type { LiveCamera } from '$lib/types';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = () => ({
	cameras: config.cameras.map((c): LiveCamera => ({ ...c, recorded: linkedCamera(c.id) !== null })),
	weatherConfigured: config.weatherLocations.length > 0,
	workoutConfigured: config.workoutToken !== '',
	workoutAppUrl: config.workoutAppUrl,
	calendarConfigured: calendarConfigured(),
	presenceConfigured: config.presenceUrl !== '',
	cabinConfigured: config.cabinCameraUrl !== '',
	climateConfigured: config.climateUrl !== '',
	telescopeConfigured: config.telescopeUrl !== '',
	telescopeSiteConfigured: config.telescopeSite !== null,
	protectConfigured: config.protectUser !== '' && config.protectPass !== '',
	/** The cabin's Protect (UCG Max, over the VPN): fetched after the page loads. */
	cabinProtectConfigured: config.protectUser !== '' && config.protectPass !== '' && config.cabinProtectUrl !== '',
	listsConfigured: config.listsToken !== '',
	listsAppUrl: config.listsAppUrl,
	homelabAppUrl: config.homelabAppUrl,
	/** Sites with BluOS players (BLUOS_PLAYERS): a Music card on Home, a Cabin music card on the Cabin tab. */
	musicSites: [...new Set(config.musicPlayers.map((p) => p.site))]
});
