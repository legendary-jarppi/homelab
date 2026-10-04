import { env } from '$env/dynamic/private';

export interface Camera {
	id: string;
	label: string;
}

function optionalNumber(value: string | undefined): number | null {
	if (!value) return null;
	const n = Number(value);
	return Number.isFinite(n) ? n : null;
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
	weather: {
		latitude: optionalNumber(env.WEATHER_LATITUDE),
		longitude: optionalNumber(env.WEATHER_LONGITUDE),
		name: env.WEATHER_NAME ?? ''
	},
	passcode: env.PASSCODE ?? ''
};
