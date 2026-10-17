// The cabin's heat pumps through apps/climate (cluster-internal), for the Cabin tab.
//   GET  /api/climate                 everything
//   POST /api/climate?device=nibe     { offset?, hotWaterDemand? }
//   POST /api/climate?device=innova   { power?, mode?, target?, fan? }
import { error, json } from '@sveltejs/kit';
import { config } from '$lib/server/config';
import type { RequestHandler } from './$types';

async function forward(path: string, init?: RequestInit): Promise<Response> {
	if (!config.climateUrl) error(404, 'Climate not configured');
	try {
		const response = await fetch(`${config.climateUrl}${path}`, { ...init, signal: AbortSignal.timeout(20_000) });
		return new Response(await response.text(), { status: response.status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
	} catch (e) {
		return json({ message: `Climate service unavailable: ${(e as Error).message}` }, { status: 502 });
	}
}

export const GET: RequestHandler = () => forward('/api/climate');

export const POST: RequestHandler = async ({ request, url }) => {
	const device = url.searchParams.get('device');
	if (device !== 'nibe' && device !== 'innova') error(400, 'device must be nibe or innova');
	return forward(`/api/${device}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: await request.text() });
};
