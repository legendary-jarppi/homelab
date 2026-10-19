import type { Handle } from '@sveltejs/kit';
import { isPublicRequest, publicAllowed } from '$lib/server/public';

/**
 * No login: telescope.lab.internal is reachable only on the home network and the VPN (through Traefik). The
 * public host (PUBLIC_HOST, through cloudflared behind Cloudflare Access) gets the published gallery only,
 * read-only: anything else is 404, as if it did not exist ($lib/server/public.ts).
 */
export const handle: Handle = async ({ event, resolve }) => {
	event.locals.public = isPublicRequest(event.request);
	if (event.locals.public && !(await publicAllowed(event.request.method, event.url.pathname))) {
		return new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
	}
	const response = await resolve(event);
	response.headers.set('X-Frame-Options', 'DENY');
	response.headers.set('X-Content-Type-Options', 'nosniff');
	response.headers.set('Referrer-Policy', 'same-origin');
	return response;
};
