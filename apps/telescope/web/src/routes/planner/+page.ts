import { loadTargets } from '$lib/targets.svelte';
import type { SessionSummary } from '$lib/types';
import type { PageLoad } from './$types';

/** The catalog is bundled; the wishlist and the integration so far come from the service (optional: the planner works without them). */
export const load: PageLoad = async ({ fetch }) => {
	const [goals, sessions] = await Promise.all([
		loadTargets(fetch),
		fetch('/api/sessions')
			.then((r) => (r.ok ? (r.json() as Promise<SessionSummary[]>) : []))
			.catch(() => [])
	]);
	return { ...goals, sessions };
};
