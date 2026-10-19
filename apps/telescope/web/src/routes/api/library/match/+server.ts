import { error } from '@sveltejs/kit';
import { proxyJson, TARGET } from '$lib/server/telescope';
import type { RequestHandler } from './$types';

/** The masters the processor would use for a target's lights, with warnings (?target=<ASIAIR target name>). */
export const GET: RequestHandler = ({ url }) => {
	const target = url.searchParams.get('target') ?? '';
	if (!TARGET.test(target)) error(400, 'target expected');
	return proxyJson(`/api/library/match?target=${encodeURIComponent(target)}`, {}, 10_000, 'processor');
};
