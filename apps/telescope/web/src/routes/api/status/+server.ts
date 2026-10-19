import { proxyJson } from '$lib/server/telescope';
import type { RequestHandler } from './$types';

/** The service's /api/status (it answers from memory, so a slow answer means it is in trouble). */
export const GET: RequestHandler = () => proxyJson('/api/status', {}, 5000);
