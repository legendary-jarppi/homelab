import type { Handle, ServerInit } from '@sveltejs/kit';
import { startBackgroundRefresh } from '$lib/server/packages';

export const init: ServerInit = () => startBackgroundRefresh();

/** No login: the public address is behind Cloudflare Access; on the home network the dashboard is open. */
export const handle: Handle = async ({ event, resolve }) => {
	const response = await resolve(event);
	response.headers.set('X-Frame-Options', 'DENY');
	response.headers.set('X-Content-Type-Options', 'nosniff');
	response.headers.set('Referrer-Policy', 'same-origin');
	return response;
};
