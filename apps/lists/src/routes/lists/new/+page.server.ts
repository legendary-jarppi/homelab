import { fail, redirect } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { FormError, parseList } from '$lib/server/form';
import { createList } from '$lib/server/lists';
import type { Actions } from './$types';

export const actions: Actions = {
	default: async ({ request }) => {
		let input;
		try {
			input = parseList(await request.formData());
		} catch (e) {
			if (e instanceof FormError) return fail(400, { error: e.message });
			throw e;
		}
		const list = await createList(db(), input);
		redirect(303, `/lists/${list.slug}`);
	}
};
