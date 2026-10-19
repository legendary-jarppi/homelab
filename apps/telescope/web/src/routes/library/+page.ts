import type { Library, SessionSummary } from '$lib/types';
import type { PageLoad } from './$types';

/** The library from the processor (the page says why when it does not answer); targets from the session list. */
export const load: PageLoad = async ({ fetch }) => {
	const [library, sessions] = await Promise.all([
		fetch('/api/library')
			.then(async (r) => (r.ok ? { library: (await r.json()) as Library, libraryError: null } : { library: null, libraryError: ((await r.json().catch(() => null))?.message as string | undefined) ?? `HTTP ${r.status}` }))
			.catch((e: Error) => ({ library: null, libraryError: e.message })),
		fetch('/api/sessions')
			.then((r) => (r.ok ? (r.json() as Promise<SessionSummary[]>) : []))
			.catch(() => [])
	]);
	return { ...library, sessions };
};
