import { error } from '@sveltejs/kit';
import { latest, papers, parseCursor, readerContext } from '$lib/server/articles';
import type { PageServerLoad } from './$types';

/** One paper's stories that pass this reader's settings, newest first, with the other papers to switch to. */
export const load: PageServerLoad = async ({ locals, params, url }) => {
	const ctx = await readerContext(locals);
	const all = await papers(ctx);
	const paper = all.find((p) => p.slug === params.slug);
	if (!paper) error(404, 'Not found');
	const cursor = parseCursor(url.searchParams.get('before'));
	const list = paper.hidden ? { cards: [], next: null } : await latest(ctx, cursor, paper.id);
	return { paper, papers: all, ...list, paged: cursor !== null };
};
