import { createHash, timingSafeEqual } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { fail, redirect } from '@sveltejs/kit';
import { config } from '$lib/server/config';
import { SESSION_COOKIE, SESSION_MAX_AGE_S, createSession, verifySession } from '$lib/server/session';
import type { Actions, PageServerLoad } from './$types';

const MAX_FAILURES = 5;
const LOCKOUT_MS = 15 * 60 * 1000;
/** Per client address: failed attempts and when the counter resets. In-memory; one replica. */
const failures = new Map<string, { count: number; resetAt: number }>();

export const load: PageServerLoad = ({ cookies }) => {
	if (verifySession(cookies.get(SESSION_COOKIE))) redirect(303, '/');
};

export const actions: Actions = {
	default: async ({ request, cookies, getClientAddress, url }) => {
		if (!config.passcode) return fail(500, { error: 'Passcode is not configured.' });

		const client = getClientAddress();
		const now = Date.now();
		if ((failures.get(client)?.resetAt ?? Infinity) < now) failures.delete(client);
		const current = failures.get(client);
		if (current && current.count >= MAX_FAILURES) {
			const minutes = Math.ceil((current.resetAt - now) / 60000);
			return fail(429, { error: `Too many attempts. Try again in ${minutes} min.` });
		}

		const passcode = String((await request.formData()).get('passcode') ?? '');
		// Hash both sides so the comparison is constant-time regardless of length.
		const given = createHash('sha256').update(passcode).digest();
		const expected = createHash('sha256').update(config.passcode).digest();
		if (!timingSafeEqual(given, expected)) {
			const count = (current?.count ?? 0) + 1;
			failures.set(client, { count, resetAt: current?.resetAt ?? now + LOCKOUT_MS });
			console.warn(`failed login from ${client} (${count}/${MAX_FAILURES})`);
			await sleep(600);
			return fail(401, { error: 'Wrong passcode.' });
		}

		failures.delete(client);
		console.info(`login from ${client}`);
		cookies.set(SESSION_COOKIE, createSession(now), {
			path: '/',
			httpOnly: true,
			sameSite: 'lax',
			secure: url.protocol === 'https:',
			maxAge: SESSION_MAX_AGE_S
		});
		redirect(303, '/');
	}
};
