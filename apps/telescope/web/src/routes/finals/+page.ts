import { loadFinals } from '$lib/finals.svelte';
import type { SessionSummary } from '$lib/types';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ fetch }) => {
	const [finals, sessions] = await Promise.all([
		loadFinals(fetch),
		fetch('/api/sessions')
			.then((r) => (r.ok ? (r.json() as Promise<SessionSummary[]>) : []))
			.catch(() => [])
	]);
	return { ...finals, sessions };
};
