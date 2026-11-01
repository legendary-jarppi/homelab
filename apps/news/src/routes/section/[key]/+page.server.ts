import { error } from '@sveltejs/kit';
import { isSection, parseCursor, readerContext, sectionEarlier, sectionFront } from '$lib/server/articles';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params, url }) => {
	if (!isSection(params.key)) error(404, 'Not found');
	const ctx = await readerContext(locals);
	const cursor = parseCursor(url.searchParams.get('before'));
	const [stories, earlier] = await Promise.all([cursor ? [] : sectionFront(ctx, params.key), sectionEarlier(ctx, params.key, cursor)]);
	return { key: params.key, stories, earlier, paged: cursor !== null };
};
