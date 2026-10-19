import { config } from '$lib/server/config';
import type { LayoutServerLoad } from './$types';

/** Public mode (the gallery host) gets no site: the cabin's position stays in the lab. */
export const load: LayoutServerLoad = ({ locals }) => ({
	site: locals.public ? null : config.site,
	configured: config.telescopeUrl !== '',
	public: locals.public
});
