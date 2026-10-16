import type { Handle, ServerInit } from '@sveltejs/kit';
import { accessConfigured, accessEmail } from '$lib/server/access';
import { config } from '$lib/server/config';
import { db, migrate } from '$lib/server/db';
import { userByEmail } from '$lib/server/notify';
import { topics } from '$lib/server/topics';

/** Without a person: /api checks the sender's bearer token, /healthz is the probe. Built assets and
 * static files (manifest, icons, service worker) are served before this hook. */
const NO_USER_PATHS = ['/healthz', '/api/'];

export const init: ServerInit = async () => {
	topics();
	const applied = await migrate(db(), config.migrationsDir);
	if (applied.length > 0) console.info(`applied migrations: ${applied.join(', ')}`);
};

const text = (status: number, body: string) => new Response(body, { status, headers: { 'content-type': 'text/plain; charset=utf-8' } });

export const handle: Handle = async ({ event, resolve }) => {
	if (!NO_USER_PATHS.some((p) => event.url.pathname.startsWith(p))) {
		if (!accessConfigured()) return text(503, 'Sign-in (Cloudflare Access) is not configured yet.');
		const email = await accessEmail(event.request);
		if (!email) return text(403, 'Open this app through its Cloudflare Access address.');
		event.locals.user = await userByEmail(db(), email);
	}

	const response = await resolve(event);
	response.headers.set('X-Frame-Options', 'DENY');
	response.headers.set('X-Content-Type-Options', 'nosniff');
	response.headers.set('Referrer-Policy', 'same-origin');
	return response;
};
