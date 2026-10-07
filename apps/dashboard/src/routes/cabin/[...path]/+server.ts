import { error } from '@sveltejs/kit';
import { config } from '$lib/server/config';
import type { RequestHandler } from './$types';

/** One cabin snapshot, streamed from apps/cabin-camera (which accepts only pictures under its upload root). */
export const GET: RequestHandler = async ({ params }) => {
	if (!config.cabinCameraUrl) error(404, 'Cabin camera not configured');
	const path = params.path.split('/').map(encodeURIComponent).join('/');
	const response = await fetch(new URL(`/snapshots/${path}`, config.cabinCameraUrl), { signal: AbortSignal.timeout(15_000) });
	if (!response.ok || !response.body) error(response.status === 404 ? 404 : 502, 'Snapshot unavailable');
	return new Response(response.body, {
		headers: {
			'Content-Type': response.headers.get('content-type') ?? 'application/octet-stream',
			// Snapshots never change under the same name; private: the dashboard is behind a login.
			'Cache-Control': 'private, max-age=86400, immutable'
		}
	});
};
