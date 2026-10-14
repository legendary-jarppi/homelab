import { db } from '$lib/server/db';
import { itemCounts, items, lists, people } from '$lib/server/lists';
import type { PageServerLoad } from './$types';

/** Every list with its item count and first three items (in the list's order). */
export const load: PageServerLoad = async () => {
	const sql = db();
	const [everyone, all, counts] = await Promise.all([people(sql), lists(sql), itemCounts(sql)]);
	const previews = await Promise.all(all.map((l) => items(sql, l, { limit: 3 })));
	return {
		people: everyone,
		lists: all.map((list, i) => ({ list, count: counts.get(list.id) ?? 0, preview: previews[i] }))
	};
};
