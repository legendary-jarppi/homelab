import { proxyJson } from '$lib/server/telescope';
import type { RequestHandler } from './$types';

/** A5: every archived auto focus run (the service parses the Autorun logs again when one changes). */
export const GET: RequestHandler = () => proxyJson('/api/focus', {}, 15_000);
