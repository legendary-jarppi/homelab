import { config } from '$lib/server/config';
import type { LayoutServerLoad } from './$types';

/** Public mode (the share host) gets no site: the cabin's position stays private. */
export const load: LayoutServerLoad = ({ locals }) => ({
	site: locals.public ? null : config.site,
	configured: config.telescopeUrl !== '',
	public: locals.public,
	/** Where published pictures can be shown to anyone (no login). */
	shareBase: config.publicHost ? `https://${config.publicHost}` : null
});
