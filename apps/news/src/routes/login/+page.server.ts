import { fail, redirect } from '@sveltejs/kit';
import { createSession, hashPassword, verifyPassword } from '$lib/core/auth';
import { db } from '$lib/core/db';
import { safeNext } from '$lib/server/next';
import { setSessionCookie } from '$lib/server/session';
import type { Actions, PageServerLoad } from './$types';

const MAX_FAILURES = 5;
const WINDOW_MS = 15 * 60_000;
/** Failed attempts per client address + username, in memory (one web pod). */
const failures = new Map<string, { count: number; until: number }>();

// Verifying against a throwaway hash keeps unknown usernames as slow as wrong passwords.
let decoyHash: Promise<string> | null = null;

export const load: PageServerLoad = async ({ locals, url }) => {
	if (locals.user) redirect(303, safeNext(url.searchParams.get('next'), url.origin));
	return {};
};

export const actions: Actions = {
	default: async ({ request, cookies, url, getClientAddress }) => {
		const form = await request.formData();
		const username = String(form.get('username') ?? '').trim().slice(0, 64);
		const password = String(form.get('password') ?? '').slice(0, 1024);
		const key = `${getClientAddress()}|${username.toLowerCase()}`;
		const now = Date.now();
		const entry = failures.get(key);
		if (entry && entry.until > now && entry.count >= MAX_FAILURES) {
			return fail(429, { username, message: 'Too many attempts. Please wait a few minutes and try again.' });
		}

		const [user] = username
			? await db()<{ id: number; password_hash: string }[]>`SELECT id, password_hash FROM users WHERE lower(username) = lower(${username})`
			: [];
		decoyHash ??= hashPassword('decoy password');
		const ok = await verifyPassword(password, user?.password_hash ?? (await decoyHash));
		if (!user || !ok) {
			for (const [k, v] of failures) if (v.until <= now) failures.delete(k);
			const current = failures.get(key);
			failures.set(key, current && current.until > now ? { count: current.count + 1, until: current.until } : { count: 1, until: now + WINDOW_MS });
			console.warn(`sign-in failed for "${username}" from ${getClientAddress()}`);
			return fail(400, { username, message: 'That username and password don’t match.' });
		}

		failures.delete(key);
		const session = await createSession(db(), user.id, request.headers.get('user-agent'));
		setSessionCookie(cookies, session.token, session.maxAgeS);
		console.info(`signed in "${username}" from ${getClientAddress()} over ${url.protocol.replace(':', '')}`);
		// Through /login/check, which tells the user when the browser did not keep the cookie.
		redirect(303, `/login/check?next=${encodeURIComponent(safeNext(url.searchParams.get('next'), url.origin))}`);
	}
};
