import { proxyJson } from '$lib/server/telescope';
import type { RequestHandler } from './$types';

/** Goals and the wishlist (the service's target store). */
export const GET: RequestHandler = () => proxyJson('/api/targets');
