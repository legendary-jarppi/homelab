import type { Cookies } from '@sveltejs/kit';

export const SESSION_COOKIE = 'ssn_session';

export function setSessionCookie(cookies: Cookies, url: URL, token: string, maxAgeS: number) {
	cookies.set(SESSION_COOKIE, token, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure: url.protocol === 'https:',
		maxAge: maxAgeS
	});
}
