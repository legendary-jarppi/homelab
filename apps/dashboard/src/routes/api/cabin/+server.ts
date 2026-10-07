import { error, json } from '@sveltejs/kit';
import { config } from '$lib/server/config';
import type { CabinData } from '$lib/types';
import type { RequestHandler } from './$types';

/**
 * The cabin camera's latest pictures and clips from apps/cabin-camera (its NetworkPolicy admits only this
 * app); 48 files are about the last 24 motion events, each a picture plus a clip.
 */
export const GET: RequestHandler = async () => {
	if (!config.cabinCameraUrl) error(404, 'Cabin camera not configured');
	const response = await fetch(new URL('/api/snapshots?limit=48', config.cabinCameraUrl), { signal: AbortSignal.timeout(5000) });
	if (!response.ok) error(502, `cabin-camera: ${response.status}`);
	const body: CabinData = await response.json();
	return json(body, { headers: { 'Cache-Control': 'no-store' } });
};
