// Goals and the wishlist (C1, C5): the service's target store through /api/targets. One store per page
// (never module state: the server renders pages for several requests).
import type { TargetGoal, Targets } from './types';

export type GoalPatch = Partial<Pick<TargetGoal, 'goalHours' | 'wishlist' | 'note'>>;

export class TargetStore {
	targets = $state.raw<Record<string, TargetGoal>>({});
	/** Why the store could not be read or written (the service may be older than the store). */
	error = $state<string | null>(null);
	/** The key being saved. */
	busy = $state<string | null>(null);

	constructor(initial: Targets | null, error: string | null) {
		this.targets = initial?.targets ?? {};
		this.error = error;
	}

	async save(key: string, patch: GoalPatch) {
		this.busy = key;
		try {
			const response = await fetch(`/api/targets/${encodeURIComponent(key)}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(patch) });
			if (!response.ok) throw new Error((await response.json().catch(() => null))?.message ?? `HTTP ${response.status}`);
			const entry = (await response.json()) as TargetGoal;
			const next = { ...this.targets };
			if (entry.goalHours === null && !entry.wishlist && entry.note === null) delete next[key];
			else next[key] = entry;
			this.targets = next;
			this.error = null;
		} catch (e) {
			this.error = `Could not save ${key}: ${(e as Error).message}`;
		} finally {
			this.busy = null;
		}
	}
}

/** Load /api/targets for a page (failures become the store's error, not the page's). */
export async function loadTargets(fetcher: typeof fetch): Promise<{ targets: Targets | null; targetsError: string | null }> {
	try {
		const response = await fetcher('/api/targets');
		if (!response.ok) return { targets: null, targetsError: response.status === 404 ? 'The telescope service has no target store yet (an older version).' : `Target store unavailable (HTTP ${response.status}).` };
		return { targets: (await response.json()) as Targets, targetsError: null };
	} catch (e) {
		return { targets: null, targetsError: (e as Error).message };
	}
}
