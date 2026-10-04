import { db } from '$lib/core/db';
import { adminIdOf, reports, resolveReport } from '$lib/server/admin';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const [open, resolved] = await Promise.all([reports(db(), true), reports(db(), false, 20)]);
	return { open, resolved };
};

export const actions = {
	resolve: async ({ request, locals }) => {
		const adminId = adminIdOf(locals);
		await resolveReport(db(), Number((await request.formData()).get('id')), adminId);
		return { message: 'Report resolved.' };
	}
} satisfies Actions;
