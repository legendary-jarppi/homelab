import { error, fail } from '@sveltejs/kit';
import { today } from '$lib/domain';
import { config } from '$lib/server/config';
import { db } from '$lib/server/db';
import { FormError, parseItem } from '$lib/server/form';
import { createItem, items, listBySlug, people, usedServices } from '$lib/server/lists';
import type { Actions, PageServerLoad } from './$types';

/** The list's items in its order; ?p=<person id> keeps one person's, ?q= searches title, service and note. */
export const load: PageServerLoad = async ({ params, url }) => {
	const sql = db();
	const list = await listBySlug(sql, params.slug);
	if (!list) error(404, 'No such list');
	const person = Number(url.searchParams.get('p')) || null;
	const q = (url.searchParams.get('q') ?? '').slice(0, 100);
	const [everyone, entries, services] = await Promise.all([people(sql), items(sql, list, { person, q }), usedServices(sql, list.id)]);
	return { list, people: everyone, items: entries, services, person, q, today: today(config.timeZone) };
};

export const actions: Actions = {
	add: async ({ params, request }) => {
		const sql = db();
		const list = await listBySlug(sql, params.slug);
		if (!list) error(404, 'No such list');
		try {
			await createItem(sql, list.id, parseItem(await request.formData(), list, await people(sql)));
		} catch (e) {
			if (e instanceof FormError) return fail(400, { error: e.message });
			throw e;
		}
		return { added: true };
	}
};
