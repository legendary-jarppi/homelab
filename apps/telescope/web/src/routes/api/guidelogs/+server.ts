import { proxyJson } from '$lib/server/telescope';
import type { RequestHandler } from './$types';

/** D7: the archived PHD2 guide logs with their RMS (a log not analysed yet is analysed first: ~0.3 s each). */
export const GET: RequestHandler = () => proxyJson('/api/guidelogs', {}, 60_000);
