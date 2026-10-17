// The cabin telescope's imaging session through apps/telescope (cluster-internal), for the Telescope tab.
import { error, json } from '@sveltejs/kit';
import { config } from '$lib/server/config';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => {
	if (!config.telescopeUrl) error(404, 'Telescope not configured');
	try {
		// The service answers from memory (it polls the ASIAIR itself), so a slow answer means it is in trouble.
		const response = await fetch(`${config.telescopeUrl}/api/status`, { signal: AbortSignal.timeout(5000) });
		return new Response(await response.text(), { status: response.status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
	} catch (e) {
		return json({ message: `Telescope service unavailable: ${(e as Error).message}` }, { status: 502 });
	}
};
