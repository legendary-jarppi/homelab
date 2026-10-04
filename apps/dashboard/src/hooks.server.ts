import { redirect, type Handle } from '@sveltejs/kit';
import { SESSION_COOKIE, verifySession } from '../session.js';

/** Reachable without a session. Built assets (/_app, static files) are served before this hook. */
const PUBLIC_PATHS = ['/login', '/manifest.webmanifest', '/icons/'];

export const handle: Handle = async ({ event, resolve }) => {
	const path = event.url.pathname;
	event.locals.authenticated = verifySession(event.cookies.get(SESSION_COOKIE));

	if (!event.locals.authenticated && !PUBLIC_PATHS.some((p) => path.startsWith(p))) {
		if (path.startsWith('/api/') || path.startsWith('/cameras/')) {
			return new Response('Unauthorized', { status: 401 });
		}
		redirect(303, '/login');
	}

	const response = await resolve(event);
	response.headers.set('X-Frame-Options', 'DENY');
	response.headers.set('X-Content-Type-Options', 'nosniff');
	response.headers.set('Referrer-Policy', 'same-origin');
	return response;
};
