import { proxyJson } from '$lib/server/telescope';
import type { RequestHandler } from './$types';

/** D2: the calibration library (sets and masters) from the processor. */
export const GET: RequestHandler = () => proxyJson('/api/library', {}, 10_000, 'processor');
