// Server-side cache for the outside sources: one fetch at a time per key, the answer kept for `ttlMs`.
// When a refresh fails, the last good answer is served for up to `staleMs` before the source counts as
// unavailable; failures are remembered for a minute so a dead source is not hammered.
import type { Sourced } from '$lib/types';

const FAILURE_MS = 60_000;

interface Entry {
	data?: unknown;
	at?: number;
	error?: string;
	failedAt?: number;
	pending?: Promise<void>;
}

const entries = new Map<string, Entry>();

export async function cached<T>(key: string, ttlMs: number, staleMs: number, load: () => Promise<T>): Promise<Sourced<T>> {
	let entry = entries.get(key);
	if (!entry) entries.set(key, (entry = {}));
	const now = Date.now();
	const fresh = entry.at !== undefined && now - entry.at < ttlMs;
	const recentlyFailed = entry.failedAt !== undefined && now - entry.failedAt < FAILURE_MS;
	if (!fresh && !recentlyFailed) {
		const e = entry;
		e.pending ??= load()
			.then((data) => {
				e.data = data;
				e.at = Date.now();
				e.error = undefined;
				e.failedAt = undefined;
			})
			.catch((err: unknown) => {
				e.error = err instanceof Error ? err.message : String(err);
				e.failedAt = Date.now();
				console.error(`${key}: ${e.error}`);
			})
			.finally(() => (e.pending = undefined));
		await e.pending;
	}
	if (entry.at !== undefined && Date.now() - entry.at < staleMs) return { data: entry.data as T, error: null, fetchedAt: entry.at };
	return { data: null, error: entry.error ?? 'unavailable', fetchedAt: null };
}

/** GET a JSON document with a timeout; a non-2xx answer is an error. */
export async function fetchJson<T>(url: string | URL, timeoutMs = 10_000): Promise<T> {
	const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), headers: { accept: 'application/json' } });
	if (!response.ok) throw new Error(`${new URL(url).host}: HTTP ${response.status}`);
	return (await response.json()) as T;
}
