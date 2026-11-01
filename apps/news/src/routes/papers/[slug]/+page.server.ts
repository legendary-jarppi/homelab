import { error } from '@sveltejs/kit';
import { latest, paperFront, papers, parseCursor, readerContext } from '$lib/server/articles';
import type { PageServerLoad } from './$types';

/** One paper: its most important stories now, then everything from it newest first, with the other papers to switch to. */
export const load: PageServerLoad = async ({ locals, params, url }) => {
	const ctx = await readerContext(locals);
	const all = await papers(ctx);
	const paper = all.find((p) => p.slug === params.slug);
	if (!paper) error(404, 'Not found');
	const cursor = parseCursor(url.searchParams.get('before'));
	if (paper.hidden) return { paper, papers: all, top: [], cards: [], next: null, paged: cursor !== null };
	const [top, list] = await Promise.all([cursor ? [] : paperFront(ctx, paper.id), latest(ctx, cursor, paper.id)]);
	return { paper, papers: all, top, ...list, paged: cursor !== null };
};
