import { fail, redirect } from '@sveltejs/kit';
import { createSession, findInvite, redeemInvite, SignupError } from '$lib/core/auth';
import { db } from '$lib/core/db';
import { i18n } from '$lib/i18n';
import { setSessionCookie } from '$lib/server/session';
import type { Actions, PageServerLoad } from './$types';

const MIN_PASSWORD = 10;
const USERNAME_RE = /^[\p{L}\p{N}._-]{3,32}$/u;

export const load: PageServerLoad = async ({ params }) => {
	const invite = await findInvite(db(), params.code);
	return { valid: invite !== null };
};

export const actions: Actions = {
	default: async ({ params, request, cookies, locals }) => {
		const form = await request.formData();
		const username = String(form.get('username') ?? '').trim();
		const displayName = String(form.get('displayName') ?? '').trim().replace(/\s+/g, ' ');
		const password = String(form.get('password') ?? '');
		const confirm = String(form.get('confirm') ?? '');
		const values = { username, displayName };
		const i = i18n(locals.locale);

		if (!USERNAME_RE.test(username)) return fail(400, { ...values, field: 'username', message: i.t('join.error.username') });
		if (displayName.length < 1 || displayName.length > 60) return fail(400, { ...values, field: 'displayName', message: i.t('join.error.name') });
		if ([...password].length < MIN_PASSWORD) return fail(400, { ...values, field: 'password', message: i.t('join.error.short', { n: MIN_PASSWORD }) });
		if (password.length > 1024) return fail(400, { ...values, field: 'password', message: i.t('join.error.long') });
		if (password !== confirm) return fail(400, { ...values, field: 'confirm', message: i.t('join.error.differ') });

		let userId: number;
		try {
			userId = await redeemInvite(db(), params.code, { username, displayName, password });
		} catch (e) {
			// SignupError means the invite is no longer usable or the username is taken; a fresh look at the invite tells which.
			if (e instanceof SignupError) {
				const message = (await findInvite(db(), params.code)) ? i.t('join.error.taken') : i.t('join.error.invite');
				return fail(400, { ...values, field: 'username', message });
			}
			throw e;
		}
		const session = await createSession(db(), userId, request.headers.get('user-agent'));
		setSessionCookie(cookies, session.token, session.maxAgeS);
		redirect(303, '/welcome');
	}
};
