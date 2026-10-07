import { redirect, type Handle, type ServerInit } from '@sveltejs/kit';
import { config } from '$lib/server/config';
import { db, migrate } from '$lib/server/db';
import { SESSION_COOKIE, verifySession } from '$lib/server/session';

/** Reachable without a session. Built assets (/_app, static files) are served before this hook.
 * /api/summary checks its own bearer token. */
const PUBLIC_PATHS = ['/login', '/healthz', '/manifest.webmanifest', '/icons/', '/api/summary'];

export const init: ServerInit = async () => {
	const applied = await migrate(db(), config.migrationsDir);
	if (applied.length > 0) console.info(`applied migrations: ${applied.join(', ')}`);
};

export const handle: Handle = async ({ event, resolve }) => {
	const path = event.url.pathname;
	if (!verifySession(event.cookies.get(SESSION_COOKIE)) && !PUBLIC_PATHS.some((p) => path.startsWith(p))) {
		redirect(303, '/login');
	}

	const response = await resolve(event);
	response.headers.set('X-Frame-Options', 'DENY');
	response.headers.set('X-Content-Type-Options', 'nosniff');
	response.headers.set('Referrer-Policy', 'same-origin');
	return response;
};
