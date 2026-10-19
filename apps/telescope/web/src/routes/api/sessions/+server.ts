import { proxyJson } from '$lib/server/telescope';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = () => proxyJson('/api/sessions');
