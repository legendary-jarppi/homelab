// D3: final stacks from the processor (through /api/finals), refreshed while one is queued or running.
import type { Final } from './types';

/** Refresh while a final is queued or running. */
const ACTIVE_POLL_MS = 5_000;

export class FinalsData {
	list = $state.raw<Final[]>([]);
	error = $state<string | null>(null);
	busy = $state(false);
	active = $derived(this.list.some((f) => f.status === 'queued' || f.status === 'running'));

	constructor(initial: Final[] | null = null, error: string | null = null) {
		this.list = initial ?? [];
		this.error = error;
	}

	async load() {
		try {
			const response = await fetch('/api/finals');
			if (!response.ok) throw new Error((await response.json().catch(() => null))?.message ?? `HTTP ${response.status}`);
			this.list = (await response.json()) as Final[];
			this.error = null;
		} catch (e) {
			this.error = (e as Error).message;
		}
	}

	/** Queue a final of `target` (every night when `nights` is empty); true when queued. */
	async build(target: string, nights: string[]): Promise<boolean> {
		this.busy = true;
		try {
			const response = await fetch('/api/finals', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ target, ...(nights.length ? { nights } : {}) }) });
			if (!response.ok) throw new Error((await response.json().catch(() => null))?.message ?? `HTTP ${response.status}`);
			await this.load();
			return true;
		} catch (e) {
			this.error = `Could not start the final stack: ${(e as Error).message}`;
			return false;
		} finally {
			this.busy = false;
		}
	}

	/** Call from an $effect: polls while something is queued or running; returns the cleanup. */
	poll() {
		if (!this.active) return;
		const timer = setInterval(() => this.load(), ACTIVE_POLL_MS);
		return () => clearInterval(timer);
	}
}

/** Load /api/finals for a page; the processor may be missing (not set up) without failing the page. */
export async function loadFinals(fetcher: typeof fetch): Promise<{ finals: Final[] | null; finalsError: string | null }> {
	try {
		const response = await fetcher('/api/finals');
		if (!response.ok) return { finals: null, finalsError: (await response.json().catch(() => null))?.message ?? `Processor unavailable (HTTP ${response.status}).` };
		return { finals: (await response.json()) as Final[], finalsError: null };
	} catch (e) {
		return { finals: null, finalsError: (e as Error).message };
	}
}

/** The download for processing by hand: `/downloads/<target>.tar?nights=…&include=rejected`. */
export function downloadUrl(target: string, nights: string[], rejected: boolean): string {
	const query = new URLSearchParams();
	if (nights.length) query.set('nights', nights.join(','));
	if (rejected) query.set('include', 'rejected');
	return `/downloads/${encodeURIComponent(target)}.tar${query.size ? `?${query}` : ''}`;
}
