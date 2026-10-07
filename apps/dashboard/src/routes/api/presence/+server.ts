import { error, json } from '@sveltejs/kit';
import { config } from '$lib/server/config';
import type { PresenceData } from '$lib/types';
import type { RequestHandler } from './$types';

/** Who is home, from apps/presence (cluster-internal; its NetworkPolicy admits only this app). */
export const GET: RequestHandler = async () => {
	if (!config.presenceUrl) error(404, 'Presence not configured');
	const response = await fetch(new URL('/api/presence', config.presenceUrl), { signal: AbortSignal.timeout(5000) });
	if (!response.ok) error(502, `presence: ${response.status}`);
	const body: PresenceData = await response.json();
	return json(body, { headers: { 'Cache-Control': 'no-store' } });
};
