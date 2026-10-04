import { readerContext, search } from '$lib/server/articles';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	const ctx = await readerContext(locals);
	const query = (url.searchParams.get('q') ?? '').trim().slice(0, 200);
	return { query, cards: query ? await search(ctx, query) : [] };
};
