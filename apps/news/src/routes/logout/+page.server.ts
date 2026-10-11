import { redirect } from '@sveltejs/kit';
import { deleteSession } from '$lib/core/auth';
import { db } from '$lib/core/db';
import { clearSessionCookie, SESSION_COOKIE } from '$lib/server/session';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = () => redirect(303, '/');

export const actions: Actions = {
	default: async ({ cookies }) => {
		const token = cookies.get(SESSION_COOKIE);
		if (token) await deleteSession(db(), token);
		clearSessionCookie(cookies);
		redirect(303, '/login');
	}
};
