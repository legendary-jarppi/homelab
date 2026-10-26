import type { Handle, ServerInit } from '@sveltejs/kit';
import { startDigests } from '$lib/server/digest';
import { isPublicRequest, publicAllowed } from '$lib/server/public';

/** R6: tonight's pick and the morning report, scheduled once per server (one replica). */
export const init: ServerInit = () => startDigests();

/**
 * No login of its own: telescope.lab.internal is reachable only on the home network and the VPN (through
 * Traefik), telescope.shillyshally.org only through Cloudflare Access (family login). The share link host
 * (PUBLIC_HOST, open to anyone) gets the published gallery only, read-only: its root redirects to /gallery,
 * anything else is 404, as if it did not exist ($lib/server/public.ts).
 */
export const handle: Handle = async ({ event, resolve }) => {
	event.locals.public = isPublicRequest(event.request);
	if (event.locals.public && event.url.pathname === '/' && (event.request.method === 'GET' || event.request.method === 'HEAD')) {
		// Temporary (302), so browsers do not keep it if the share host's front page changes.
		return new Response(null, { status: 302, headers: { location: '/gallery', 'cache-control': 'no-store' } });
	}
	if (event.locals.public && !(await publicAllowed(event.request.method, event.url.pathname))) {
		return new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
	}
	const response = await resolve(event);
	response.headers.set('X-Frame-Options', 'DENY');
	response.headers.set('X-Content-Type-Options', 'nosniff');
	response.headers.set('Referrer-Policy', 'same-origin');
	return response;
};
