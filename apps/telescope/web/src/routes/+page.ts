import type { SessionSummary, Status } from '$lib/types';
import type { PageLoad } from './$types';

/** The first status and session list (server-side on the first visit); the page polls from there. */
export const load: PageLoad = async ({ fetch }) => {
	const get = async <T>(url: string): Promise<T | null> => {
		try {
			const response = await fetch(url);
			return response.ok ? ((await response.json()) as T) : null;
		} catch {
			return null;
		}
	};
	const [status, sessions] = await Promise.all([get<Status>('/api/status'), get<SessionSummary[]>('/api/sessions')]);
	return { status, sessions };
};
