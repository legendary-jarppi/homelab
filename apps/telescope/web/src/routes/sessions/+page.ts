import { error } from '@sveltejs/kit';
import type { SessionSummary } from '$lib/types';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ fetch }) => {
	const response = await fetch('/api/sessions');
	if (!response.ok) error(response.status === 404 ? 404 : 502, (await response.json().catch(() => null))?.message ?? (response.status === 404 ? 'The telescope service has no session list (an older version).' : 'Telescope service unavailable.'));
	return { sessions: (await response.json()) as SessionSummary[] };
};
