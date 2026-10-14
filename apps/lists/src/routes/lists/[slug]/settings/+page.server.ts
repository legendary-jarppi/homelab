import { error, fail, redirect } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { FormError, parseList } from '$lib/server/form';
import { deleteList, itemCounts, listBySlug, updateList } from '$lib/server/lists';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	const sql = db();
	const list = await listBySlug(sql, params.slug);
	if (!list) error(404, 'No such list');
	return { list, count: (await itemCounts(sql)).get(list.id) ?? 0 };
};

export const actions: Actions = {
	save: async ({ params, request }) => {
		const sql = db();
		const list = await listBySlug(sql, params.slug);
		if (!list) error(404, 'No such list');
		let input;
		try {
			input = parseList(await request.formData());
		} catch (e) {
			if (e instanceof FormError) return fail(400, { error: e.message });
			throw e;
		}
		const saved = await updateList(sql, list.id, input);
		redirect(303, `/lists/${saved.slug}`);
	},
	delete: async ({ params, request }) => {
		const sql = db();
		const list = await listBySlug(sql, params.slug);
		if (!list) error(404, 'No such list');
		// The name typed back confirms deleting the list with all its items.
		if (String((await request.formData()).get('confirm') ?? '').trim() !== list.name) {
			return fail(400, { deleteError: `Type the list's name, ${list.name}, to delete it.` });
		}
		await deleteList(sql, list.id);
		redirect(303, '/');
	}
};
