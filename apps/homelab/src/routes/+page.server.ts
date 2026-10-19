import { appLinks } from '$lib/server/docs';
import { getStatus } from '$lib/server/status';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => ({
	status: await getStatus().catch(() => null),
	docs: appLinks()
});
