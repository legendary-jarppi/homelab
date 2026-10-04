import { editionInfo, frontPage, readerContext } from '$lib/server/articles';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const ctx = await readerContext(locals);
	const edition = await editionInfo(ctx.sql);
	return { edition, front: await frontPage(ctx, edition) };
};
