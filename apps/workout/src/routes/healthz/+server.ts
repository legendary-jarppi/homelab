import { db } from '$lib/server/db';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => {
	const headers = { 'content-type': 'text/plain', 'cache-control': 'no-store' };
	try {
		await db()`SELECT 1`;
		return new Response('ok', { headers });
	} catch {
		return new Response('database unavailable', { status: 503, headers });
	}
};
