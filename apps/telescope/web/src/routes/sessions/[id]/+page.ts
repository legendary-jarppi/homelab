import { error } from '@sveltejs/kit';
import type { SessionDetail } from '$lib/types';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ fetch, params }) => {
	const response = await fetch(`/api/sessions/${encodeURIComponent(params.id)}`);
	if (!response.ok) error(response.status === 404 ? 404 : 502, (await response.json().catch(() => null))?.message ?? (response.status === 404 ? 'No such session (or the telescope service does not have it yet).' : 'Telescope service unavailable.'));
	return { session: (await response.json()) as SessionDetail };
};
