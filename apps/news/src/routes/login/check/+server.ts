import { redirect } from '@sveltejs/kit';
import { safeNext } from '$lib/server/next';
import type { RequestHandler } from './$types';

/**
 * Where a successful sign-in goes first: a full page request, so it shows whether the browser kept
 * the session cookie it was just given. Without it (Safari's "Block All Cookies", a leftover
 * https-only cookie of the same name) the user would otherwise land on the sign-in form again
 * with no explanation; the form says what to change instead.
 */
export const GET: RequestHandler = ({ locals, url, getClientAddress, request }) => {
	const next = safeNext(url.searchParams.get('next'), url.origin);
	if (locals.user) redirect(303, next);
	console.warn(`sign-in cookie not returned from ${getClientAddress()} (${request.headers.get('user-agent')?.slice(0, 120) ?? 'no user agent'})`);
	redirect(303, `/login?cookie=missing&next=${encodeURIComponent(next)}`);
};
