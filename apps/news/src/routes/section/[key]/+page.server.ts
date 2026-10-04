import { error } from '@sveltejs/kit';
import { editionInfo, parseCursor, readerContext, sectionEarlier, sectionFront, sectionLabel } from '$lib/server/articles';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params, url }) => {
	const label = sectionLabel(params.key);
	if (!label) error(404, 'Not found');
	const ctx = await readerContext(locals);
	const edition = await editionInfo(ctx.sql);
	const cursor = parseCursor(url.searchParams.get('before'));
	const [stories, earlier] = await Promise.all([cursor ? [] : sectionFront(ctx, edition, params.key), sectionEarlier(ctx, edition, params.key, cursor)]);
	return { key: params.key, label, edition, stories, earlier, paged: cursor !== null };
};
