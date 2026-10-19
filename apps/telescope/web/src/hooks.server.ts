import type { Handle } from '@sveltejs/kit';

/** No login: reachable only on the home network and the VPN (telescope.lab.internal through Traefik). */
export const handle: Handle = async ({ event, resolve }) => {
	const response = await resolve(event);
	response.headers.set('X-Frame-Options', 'DENY');
	response.headers.set('X-Content-Type-Options', 'nosniff');
	response.headers.set('Referrer-Policy', 'same-origin');
	return response;
};
