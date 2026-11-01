import { entityPage, parseCursor, parseId, readerContext } from '$lib/server/articles';
import type { PageServerLoad } from './$types';

/** A person, organisation, place or other named thing, and the visible stories about it, newest first. */
export const load: PageServerLoad = async ({ locals, params, url }) => {
	const ctx = await readerContext(locals);
	const cursor = parseCursor(url.searchParams.get('before'));
	return { ...(await entityPage(ctx, parseId(params.id), cursor)), paged: cursor !== null };
};
