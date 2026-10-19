import { error } from '@sveltejs/kit';
import { loadFinals } from '$lib/finals.svelte';
import { loadTargets } from '$lib/targets.svelte';
import type { SessionSummary } from '$lib/types';
import type { PageLoad } from './$types';

/** Sessions are needed; goals and finals are shown when their services answer. */
export const load: PageLoad = async ({ fetch }) => {
	const [response, goals, finals] = await Promise.all([fetch('/api/sessions'), loadTargets(fetch), loadFinals(fetch)]);
	if (!response.ok) error(response.status === 404 ? 404 : 502, (await response.json().catch(() => null))?.message ?? 'Telescope service unavailable.');
	return { sessions: (await response.json()) as SessionSummary[], ...goals, ...finals };
};
