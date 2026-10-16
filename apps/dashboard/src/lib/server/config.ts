import { env } from '$env/dynamic/private';

export interface Camera {
	id: string;
	label: string;
}

export interface WeatherLocation {
	name: string;
	latitude: number;
	longitude: number;
}

export const config = {
	prometheusUrl: env.PROMETHEUS_URL ?? 'http://prometheus.lab.internal',
	go2rtcUrl: env.GO2RTC_URL ?? 'http://localhost:1984',
	/** CAMERAS="front-door:Front door,backyard:Backyard" -> [{id, label}] */
	cameras: (env.CAMERAS ?? '')
		.split(',')
		.map((entry) => entry.trim())
		.filter(Boolean)
		.map((entry): Camera => {
			const [id, label] = entry.split(':');
			return { id: id.trim(), label: (label ?? id).trim() };
		}),
	/** `source` label of the home site's UniFi controller in UnPoller metrics. */
	unifiSource: env.UNIFI_SOURCE ?? 'https://192.168.1.1',
	/**
	 * WEATHER_LOCATIONS="Espoo:60.2052:24.6522,Ristiina:61.5058:27.2464" (name:latitude:longitude).
	 * The first is the primary location (hourly forecast); entries with bad coordinates are skipped.
	 */
	weatherLocations: (env.WEATHER_LOCATIONS ?? '')
		.split(',')
		.map((entry) => entry.split(':').map((part) => part.trim()))
		// Empty parts would become 0 (Number('') === 0), i.e. a location at 0°, 0°.
		.filter(([name, lat, lon]) => name && lat && lon)
		.map(([name, lat, lon]): WeatherLocation => ({ name, latitude: Number(lat), longitude: Number(lon) }))
		.filter((l) => Number.isFinite(l.latitude) && Number.isFinite(l.longitude)),
	passcode: env.PASSCODE ?? '',
	/** apps/workout, cluster-internal; the workout card is shown only when the token is set. */
	workoutUrl: env.WORKOUT_URL ?? 'http://localhost:3000',
	workoutToken: env.WORKOUT_TOKEN ?? '',
	/** Where tapping the workout card goes (the app's address in the browser). */
	workoutAppUrl: env.WORKOUT_APP_URL ?? 'http://workout.lab.internal',
	/** apps/lists, cluster-internal; its cards are shown only when the token is set (secret dashboard-lists). */
	listsUrl: env.LISTS_URL ?? 'http://localhost:3000',
	listsToken: env.LISTS_TOKEN ?? '',
	/** Where tapping a list card goes (the app's address in the browser). */
	listsAppUrl: env.LISTS_APP_URL ?? 'http://lists.lab.internal',
	/** apps/presence, cluster-internal (who is home); the card says "not set up" without it. */
	presenceUrl: env.PRESENCE_URL ?? '',
	/** apps/cabin-camera's snapshot service, cluster-internal; the cabin card is shown only when set. */
	cabinCameraUrl: env.CABIN_CAMERA_URL ?? '',
	/** UniFi Protect (the UDM Pro) for the Cameras tab's motion events; shown only with PROTECT_USER and PROTECT_PASS (secret dashboard-protect). */
	protectUrl: env.PROTECT_URL ?? 'https://192.168.1.1',
	protectUser: env.PROTECT_USER ?? '',
	protectPass: env.PROTECT_PASS ?? '',
	/** PROTECT_CAMERAS="Ulko-ovi:Front door,…": Protect camera name -> label, in display order. */
	protectCameras: (env.PROTECT_CAMERAS ?? '')
		.split(',')
		.map((entry) => entry.split(':').map((part) => part.trim()))
		.filter(([name]) => name)
		.map(([name, label]) => ({ name, label: label || name })),
	/** Google Calendar "secret address in iCal format" (secret dashboard-calendar); never sent to the browser or logged. */
	calendarIcsUrl: env.CALENDAR_ICS_URL ?? '',
	/**
	 * Google Calendar API (secret dashboard-calendar): a service account's JSON key and the calendar it
	 * may change. With both, the card reads through the API and events can be added; never logged.
	 */
	googleServiceAccount: env.GOOGLE_SERVICE_ACCOUNT ?? '',
	calendarId: env.CALENDAR_ID ?? '',
	/** Colour of the calendar's events on the card. */
	calendarColor: env.CALENDAR_COLOR ?? '#38bdf8',
	/** Tracked packages (JSON) on the dashboard's volume. */
	packagesFile: env.PACKAGES_FILE ?? '.data/packages.json',
	/** developer.ups.com OAuth app with the Tracking API (secret dashboard-packages). */
	upsClientId: env.UPS_CLIENT_ID ?? '',
	upsClientSecret: env.UPS_CLIENT_SECRET ?? '',
	/** apps/notify's sending API, cluster-internal; notifications (package ready for pickup) only with NOTIFY_TOKEN (secret dashboard-notify). */
	notifyUrl: env.NOTIFY_URL ?? 'http://localhost:3000',
	notifyToken: env.NOTIFY_TOKEN ?? '',
	/** The dashboard's own address, opened by tapping its notifications. */
	dashboardAppUrl: env.DASHBOARD_APP_URL ?? 'http://dashboard.lab.internal'
};
