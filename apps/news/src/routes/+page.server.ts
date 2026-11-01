import { frontPage, readerContext } from '$lib/server/articles';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const ctx = await readerContext(locals);
	return { front: await frontPage(ctx) };
};
