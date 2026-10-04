import { editionInfo } from '$lib/server/articles';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals }) => {
	const user = locals.user;
	if (!user) return { user: null, edition: null };
	return {
		user: { displayName: user.displayName, admin: user.role === 'admin', onboarded: locals.settings.onboarded },
		edition: await editionInfo()
	};
};
