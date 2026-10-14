import { error, json } from '@sveltejs/kit';
import { config } from '$lib/server/config';
import type { ListsData } from '$lib/types';
import type { RequestHandler } from './$types';

/** Lists marked "Show on dashboard" from apps/lists; the token never reaches the browser. */
export const GET: RequestHandler = async () => {
	if (!config.listsToken) error(404, 'Lists not configured');
	const response = await fetch(new URL('/api/dashboard', config.listsUrl), {
		headers: { authorization: `Bearer ${config.listsToken}` },
		signal: AbortSignal.timeout(5000)
	});
	if (!response.ok) error(502, `lists: ${response.status}`);
	const body: ListsData = await response.json();
	return json(body, { headers: { 'Cache-Control': 'no-store' } });
};
