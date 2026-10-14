import { error, fail, redirect } from '@sveltejs/kit';
import { today } from '$lib/domain';
import { config } from '$lib/server/config';
import { db } from '$lib/server/db';
import { FormError, parseItem } from '$lib/server/form';
import { deleteItem, item, lists, moveItem, people, updateItem, usedServices } from '$lib/server/lists';
import type { Actions, PageServerLoad } from './$types';

async function context(rawId: string) {
	const id = Number(rawId);
	if (!Number.isSafeInteger(id) || id <= 0) error(404, 'No such item');
	const sql = db();
	const found = await item(sql, id);
	if (!found) error(404, 'No such item');
	const all = await lists(sql);
	const list = all.find((l) => l.id === found.listId)!;
	return { sql, item: found, list, all };
}

export const load: PageServerLoad = async ({ params }) => {
	const { sql, item: found, list, all } = await context(params.id);
	const [everyone, services] = await Promise.all([people(sql), usedServices(sql, list.id)]);
	return {
		item: found,
		list,
		others: all.filter((l) => l.id !== list.id).map((l) => ({ id: l.id, name: l.name, useDate: l.useDate })),
		people: everyone,
		services,
		today: today(config.timeZone)
	};
};

export const actions: Actions = {
	save: async ({ params, request }) => {
		const { sql, item: found, list } = await context(params.id);
		try {
			await updateItem(sql, found.id, parseItem(await request.formData(), list, await people(sql)));
		} catch (e) {
			if (e instanceof FormError) return fail(400, { error: e.message });
			throw e;
		}
		redirect(303, `/lists/${list.slug}`);
	},
	move: async ({ params, request }) => {
		const { sql, item: found, all } = await context(params.id);
		const targetId = Number((await request.formData()).get('list'));
		const target = all.find((l) => l.id === targetId && l.id !== found.listId);
		if (!target) return fail(400, { moveError: 'Choose a list to move it to.' });
		await moveItem(sql, found.id, target, today(config.timeZone));
		// On to the item in its new list, where people and date can be checked.
		redirect(303, `/items/${found.id}`);
	},
	delete: async ({ params }) => {
		const { sql, item: found, list } = await context(params.id);
		await deleteItem(sql, found.id);
		redirect(303, `/lists/${list.slug}`);
	}
};
