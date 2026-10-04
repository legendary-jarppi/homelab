import { fail, redirect } from '@sveltejs/kit';
import { createSession, findInvite, redeemInvite, SignupError } from '$lib/core/auth';
import { db } from '$lib/core/db';
import { setSessionCookie } from '$lib/server/session';
import type { Actions, PageServerLoad } from './$types';

const MIN_PASSWORD = 10;
const USERNAME_RE = /^[\p{L}\p{N}._-]{3,32}$/u;

export const load: PageServerLoad = async ({ params }) => {
	const invite = await findInvite(db(), params.code);
	return { valid: invite !== null };
};

export const actions: Actions = {
	default: async ({ params, request, cookies, url }) => {
		const form = await request.formData();
		const username = String(form.get('username') ?? '').trim();
		const displayName = String(form.get('displayName') ?? '').trim().replace(/\s+/g, ' ');
		const password = String(form.get('password') ?? '');
		const confirm = String(form.get('confirm') ?? '');
		const values = { username, displayName };

		if (!USERNAME_RE.test(username)) return fail(400, { ...values, field: 'username', message: 'Usernames are 3 to 32 letters, digits, dots, dashes or underscores.' });
		if (displayName.length < 1 || displayName.length > 60) return fail(400, { ...values, field: 'displayName', message: 'Please give a name of up to 60 characters.' });
		if ([...password].length < MIN_PASSWORD) return fail(400, { ...values, field: 'password', message: `Passwords need at least ${MIN_PASSWORD} characters.` });
		if (password.length > 1024) return fail(400, { ...values, field: 'password', message: 'That password is too long.' });
		if (password !== confirm) return fail(400, { ...values, field: 'confirm', message: 'The two passwords differ.' });

		let userId: number;
		try {
			userId = await redeemInvite(db(), params.code, { username, displayName, password });
		} catch (e) {
			if (e instanceof SignupError) return fail(400, { ...values, field: 'username', message: e.message });
			throw e;
		}
		const session = await createSession(db(), userId, request.headers.get('user-agent'));
		setSessionCookie(cookies, url, session.token, session.maxAgeS);
		redirect(303, '/welcome');
	}
};
