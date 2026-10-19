// Settings from the environment (deploy/kustomization.yaml: telescope-web-config).
import { env } from '$env/dynamic/private';

export interface Site {
	name: string;
	lat: number;
	lon: number;
}

export const config = {
	/** apps/telescope, cluster-internal: http://telescope:8080 in the same namespace. Pages say "not set up" without it. */
	telescopeUrl: (env.TELESCOPE_URL ?? '').replace(/\/$/, ''),
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
