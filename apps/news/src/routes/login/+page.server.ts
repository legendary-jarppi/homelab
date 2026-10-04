import { fail, redirect } from '@sveltejs/kit';
import { createSession, hashPassword, verifyPassword } from '$lib/core/auth';
import { db } from '$lib/core/db';
import { setSessionCookie } from '$lib/server/session';
import type { Actions, PageServerLoad } from './$types';

const MAX_FAILURES = 5;
const WINDOW_MS = 15 * 60_000;
/** Failed attempts per client address + username, in memory (one web pod). */
const failures = new Map<string, { count: number; until: number }>();

/** Same-origin path to return to after signing in; anything else goes to the front page. */
function safeNext(raw: string | null, origin: string): string {
	if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return '/';
	try {
		const target = new URL(raw, origin);
		return target.origin === origin ? target.pathname + target.search : '/';
	} catch {
		return '/';
	}
}

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
			return fail(400, { username, message: 'That username and password don’t match.' });
		}

		failures.delete(key);
		const session = await createSession(db(), user.id, request.headers.get('user-agent'));
		setSessionCookie(cookies, url, session.token, session.maxAgeS);
		redirect(303, safeNext(url.searchParams.get('next'), url.origin));
	}
};
