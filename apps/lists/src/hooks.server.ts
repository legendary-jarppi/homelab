import type { Handle, ServerInit } from '@sveltejs/kit';
import { config } from '$lib/server/config';
import { db, migrate } from '$lib/server/db';

export const init: ServerInit = async () => {
	const applied = await migrate(db(), config.migrationsDir);
	if (applied.length > 0) console.info(`applied migrations: ${applied.join(', ')}`);
};

/** No login: the app is reachable only on the home network. /api/dashboard checks its own bearer token. */
export const handle: Handle = async ({ event, resolve }) => {
	const response = await resolve(event);
	response.headers.set('X-Frame-Options', 'DENY');
	response.headers.set('X-Content-Type-Options', 'nosniff');
	response.headers.set('Referrer-Policy', 'same-origin');
	return response;
};
