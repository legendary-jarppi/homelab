import { config } from '$lib/server/config';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = () => ({
	site: config.site,
	configured: config.telescopeUrl !== ''
});
