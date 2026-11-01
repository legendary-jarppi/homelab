import { newsstand, readerContext } from '$lib/server/articles';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => ({ papers: await newsstand(await readerContext(locals)) });
