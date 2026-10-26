// Settings from the environment (deploy/kustomization.yaml: telescope-web-config).
import { env } from '$env/dynamic/private';
// SvelteKit keeps PUBLIC_* variables out of the private env; PUBLIC_HOST is only a host name.
import { env as publicEnv } from '$env/dynamic/public';

export interface Site {
	name: string;
	lat: number;
	lon: number;
}

export const config = {
	/** apps/telescope, cluster-internal: http://telescope:8080 in the same namespace. Pages say "not set up" without it. */
	telescopeUrl: (env.TELESCOPE_URL ?? '').replace(/\/$/, ''),
	/** apps/telescope's processor (calibration library, final stacks, downloads): http://telescope-processor:8080. Those pages say "not set up" without it. */
	processorUrl: (env.PROCESSOR_URL ?? '').replace(/\/$/, ''),
	/** Prometheus (kube-prometheus-stack, namespace monitoring): the cabin's RuuviTag temperature on the session report's Focus card. Empty: no Ruuvi line. */
	prometheusUrl: (env.PROMETHEUS_URL ?? '').replace(/\/$/, ''),
	/**
	 * PUBLIC_HOST="astro.shillyshally.org": the share link host (cloudflared, open to anyone); requests for it see
	 * only the published gallery, read-only (hooks.server.ts). Empty: no share host.
	 */
	publicHost: (publicEnv.PUBLIC_HOST ?? '').trim().toLowerCase(),
	/**
	 * TELESCOPE_SITE="Ristiina:61.496:27.576" (name:latitude:longitude, as the ASIAIR reports it): conditions, wind,
	 * the automatic red mode, and the altitude curve when a session has no site of its own.
	 */
	site: ((): Site | null => {
		const [name, lat, lon] = (env.TELESCOPE_SITE ?? '').split(':').map((part) => part.trim());
		const site = { name, lat: Number(lat), lon: Number(lon) };
		return name && lat && lon && Number.isFinite(site.lat) && Number.isFinite(site.lon) ? site : null;
	})(),
	/** apps/notify's sending API, cluster-internal: http://web.notify.svc:3000. */
	notifyUrl: (env.NOTIFY_URL ?? '').replace(/\/$/, ''),
	/** This app's sender token (secret telescope-web-notify, optional): without it the digests are composed (preview, logs) but never sent. */
	notifyToken: (env.NOTIFY_TOKEN ?? '').trim(),
	/** R6 digests ($lib/server/digest.ts): local times (Europe/Helsinki) as minutes after midnight, the retry window, the clear hours a pick needs, the app's address in links. */
	digest: {
		pickAt: clockSetting('DIGEST_PICK_AT', 15 * 60),
		reportAt: clockSetting('DIGEST_REPORT_AT', 8 * 60),
		windowMin: numberSetting('DIGEST_WINDOW_MIN', 120),
		pickMinClearH: numberSetting('PICK_MIN_CLEAR_H', 3),
		link: (env.DIGEST_LINK || 'https://telescope.shillyshally.org').replace(/\/$/, '')
	}
};

/** "HH:MM" from the environment as minutes after midnight; the default when unset or malformed. */
function clockSetting(name: string, fallback: number): number {
	const value = env[name]?.trim();
	if (!value) return fallback;
	const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(value);
	if (!m) console.error(`${name}=${value}: expected HH:MM, using the default`);
	return m ? Number(m[1]) * 60 + Number(m[2]) : fallback;
}

/** A positive number from the environment; the default when unset or malformed. */
function numberSetting(name: string, fallback: number): number {
	const value = env[name]?.trim();
	if (!value) return fallback;
	const n = Number(value);
	if (!(Number.isFinite(n) && n > 0)) console.error(`${name}=${value}: expected a positive number, using the default`);
	return Number.isFinite(n) && n > 0 ? n : fallback;
}
