import { config } from '$lib/server/config';
import { conditions } from '$lib/server/conditions';
import type { PageServerLoad } from './$types';

/** Rendered on the server from the cached sources; the page reloads it every 10 minutes. */
export const load: PageServerLoad = async () => ({ conditions: config.site ? await conditions(config.site) : null });
