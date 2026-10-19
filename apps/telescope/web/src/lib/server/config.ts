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
	/**
	 * PUBLIC_HOST="telescope.shillyshally.org": requests for this host (cloudflared, behind Cloudflare Access) see
	 * only the published gallery, read-only (hooks.server.ts). Empty: no public mode.
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
	})()
};
