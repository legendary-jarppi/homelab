import { latest, parseCursor, readerContext } from '$lib/server/articles';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	const ctx = await readerContext(locals);
	const cursor = parseCursor(url.searchParams.get('before'));
	return { ...(await latest(ctx, cursor)), paged: cursor !== null };
};
