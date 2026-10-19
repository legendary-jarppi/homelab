import type { ArchitectureData } from './architecture';

/**
 * Live status for a page: the copy the server rendered it with, then GET /api/status every 30 s while
 * the tab is visible. `failed` is set while Prometheus does not answer (the last data stays).
 * Call during component initialisation.
 */
export function liveStatus(initial: ArchitectureData | null) {
	const state = $state({ data: initial, failed: initial === null });

	$effect(() => {
		let stopped = false;
		const load = async () => {
			try {
				const response = await fetch('/api/status', { cache: 'no-store' });
				if (!response.ok) throw new Error(String(response.status));
				const body: ArchitectureData = await response.json();
				if (!stopped) {
					state.data = body;
					state.failed = false;
				}
			} catch {
				if (!stopped) state.failed = true;
			}
		};
		if (state.data === null) load();
		const timer = setInterval(() => document.visibilityState === 'visible' && load(), 30_000);
		return () => {
			stopped = true;
			clearInterval(timer);
		};
	});

	return state;
}
