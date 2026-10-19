import { error, json } from '@sveltejs/kit';
import { getStatus } from '$lib/server/status';
import type { RequestHandler } from './$types';

/** Live status for Overview, Components and Devices (polled every 30 s while one of them is open). */
export const GET: RequestHandler = async () => {
	try {
		return json(await getStatus(), { headers: { 'Cache-Control': 'no-store' } });
	} catch (e) {
		console.error('status:', e instanceof Error ? e.message : e);
		error(502, 'Prometheus unavailable');
	}
};
