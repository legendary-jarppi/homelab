import { redirect, type Handle, type ServerInit } from '@sveltejs/kit';
import { sessionUser } from '$lib/core/auth';
import { db, migrate } from '$lib/core/db';
import { parseSettings } from '$lib/core/prefs';
import { SESSION_COOKIE } from '$lib/server/session';

/** Reachable without a session. */
const PUBLIC_PATHS = ['/login', '/join/', '/about', '/healthz', '/manifest.webmanifest', '/favicon'];

export const init: ServerInit = async () => {
	const applied = await migrate(db(), process.env.MIGRATIONS_DIR ?? 'migrations');
	if (applied.length > 0) console.info(`applied migrations: ${applied.join(', ')}`);
	// adapter-node stops the HTTP server on SIGTERM; idle pool connections would keep the process alive.
	process.once('sveltekit:shutdown', () => void db().end({ timeout: 5 }));
};

export const handle: Handle = async ({ event, resolve }) => {
	// Probe endpoint: no session lookup, no headers to add.
	if (event.url.pathname === '/healthz') return resolve(event);
	const user = await sessionUser(db(), event.cookies.get(SESSION_COOKIE));
	event.locals.user = user;
	event.locals.settings = parseSettings(user?.settings);
	const path = event.url.pathname;

	if (!user && !PUBLIC_PATHS.some((p) => path === p || path.startsWith(p))) {
		if (path.startsWith('/api/') || path.startsWith('/img/')) return new Response('Not found', { status: 404 });
		redirect(303, `/login?next=${encodeURIComponent(path + event.url.search)}`);
	}
	if (user && !event.locals.settings.onboarded && !path.startsWith('/welcome') && !path.startsWith('/logout') && !path.startsWith('/img/')) {
		redirect(303, '/welcome');
	}
	if (path.startsWith('/admin') && user?.role !== 'admin') return new Response('Not found', { status: 404 });

	const response = await resolve(event, {
		// Theme class on <html> before first paint.
		transformPageChunk: ({ html }) => html.replace('%theme%', event.locals.settings.theme)
	});
	response.headers.set('X-Frame-Options', 'DENY');
	response.headers.set('X-Content-Type-Options', 'nosniff');
	response.headers.set('Referrer-Policy', 'no-referrer');
	return response;
};
