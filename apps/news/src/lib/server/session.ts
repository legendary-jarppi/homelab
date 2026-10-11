import type { Cookies } from '@sveltejs/kit';

/**
 * Renamed from ssn_session: a browser that once got that name over https (Safari upgrades
 * news.lab.internal by itself) keeps it as an https-only cookie, never sends it over http, and
 * refuses to let http replace it, so every sign-in over http looked like it did nothing.
 */
export const SESSION_COOKIE = 'news_session';

/**
 * Never Secure: the site is plain http on the LAN, and a Secure cookie set during an https visit
 * would lock the browser out of http the same way. Revisit when lab.internal gets real TLS.
 */
const OPTIONS = { path: '/', httpOnly: true, sameSite: 'lax', secure: false } as const;

export function setSessionCookie(cookies: Cookies, token: string, maxAgeS: number) {
	cookies.set(SESSION_COOKIE, token, { ...OPTIONS, maxAge: maxAgeS });
}

/** With the same attributes as when set; SvelteKit's default (Secure) would be ignored over http. */
export function clearSessionCookie(cookies: Cookies) {
	cookies.delete(SESSION_COOKIE, OPTIONS);
}
