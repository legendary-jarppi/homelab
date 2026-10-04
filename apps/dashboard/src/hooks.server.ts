import { redirect, type Handle } from '@sveltejs/kit';
import { SESSION_COOKIE, verifySession } from '../session.js';

/** Reachable without a session. Built assets (/_app, static files) are served before this hook. */
const PUBLIC_PATHS = ['/login', '/manifest.webmanifest', '/icons/'];

export const handle: Handle = async ({ event, resolve }) => {
	const path = event.url.pathname;
	const session = event.cookies.get(SESSION_COOKIE);
	event.locals.authenticated = verifySession(session);

	if (!event.locals.authenticated && !PUBLIC_PATHS.some((p) => path.startsWith(p))) {
		if (path.startsWith('/api/') || path.startsWith('/cameras/')) {
			return new Response('Unauthorized', { status: 401 });
		}
		// Page loads only (not API polling): shows whether a browser lost or never stored the cookie.
		if (path === '/' || path === '/__data.json') {
			console.warn(
				`no valid session for ${path} from ${event.getClientAddress()}: cookie ${session ? 'invalid/expired' : 'not sent'}` +
					` (${event.request.headers.get('user-agent')?.slice(0, 120) ?? 'no user agent'})`
			);
		}
		redirect(303, '/login');
	}

	const response = await resolve(event);
	response.headers.set('X-Frame-Options', 'DENY');
	response.headers.set('X-Content-Type-Options', 'nosniff');
	response.headers.set('Referrer-Policy', 'same-origin');
	return response;
};
