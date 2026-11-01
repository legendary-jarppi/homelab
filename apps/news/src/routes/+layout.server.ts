import { db } from '$lib/core/db';
import { lastUpdate, paperLinks } from '$lib/server/articles';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals }) => {
	const user = locals.user;
	if (!user) return { user: null, locale: locals.locale, updatedAt: null, papers: [] };
	const sql = db();
	const [updatedAt, papers] = await Promise.all([lastUpdate(sql), paperLinks(sql, user.id)]);
	return {
		user: { displayName: user.displayName, admin: user.role === 'admin', onboarded: locals.settings.onboarded },
		locale: locals.locale,
		updatedAt,
		papers
	};
};
