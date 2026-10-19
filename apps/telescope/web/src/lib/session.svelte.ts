// A session's report from the service (through /api/sessions/<id>) and the wind at the site over it.
import type { SessionDetail, Sourced, WindPoint } from './types';

export class SessionData {
	/** Raw: replaced as a whole on every load (thousands of guiding points need no deep reactivity). */
	detail = $state.raw<SessionDetail | null>(null);
	error = $state<string | null>(null);
	wind = $state.raw<WindPoint[] | null>(null);
	windError = $state<string | null>(null);
	#windKey = '';

	constructor(initial: SessionDetail | null = null) {
		this.detail = initial;
	}

	async load(id: string) {
		try {
			const response = await fetch(`/api/sessions/${encodeURIComponent(id)}`);
			if (!response.ok) throw new Error((await response.json().catch(() => null))?.message ?? `HTTP ${response.status}`);
			this.detail = (await response.json()) as SessionDetail;
			this.error = null;
		} catch (e) {
			this.error = (e as Error).message;
		}
		await this.loadWind();
	}

	/** Hourly wind over the session (refetched when the session reaches a new hour). */
	async loadWind() {
		const d = this.detail;
		if (!d) return;
		const from = Math.floor(d.firstFrameAt / 3600) * 3600 - 3600;
		const to = Math.min(from + 3 * 86_400, Math.ceil(Math.max(d.lastFrameAt, d.active ? Date.now() / 1000 : 0) / 3600) * 3600 + 3600);
		const key = `${d.id} ${from} ${to}`;
		if (key === this.#windKey) return;
		try {
			const response = await fetch(`/api/wind?from=${from}&to=${to}`);
			if (!response.ok) throw new Error(`HTTP ${response.status}`);
			const body = (await response.json()) as Sourced<WindPoint[]>;
			this.wind = body.data;
			this.windError = body.error;
			if (body.data) this.#windKey = key;
		} catch (e) {
			this.windError = (e as Error).message;
		}
	}
}

/** The stack preview's URL for one version of the stack. */
export function stackUrl(sessionId: string, imageId: string | null | undefined, small = false): string {
	return `/stacks/${encodeURIComponent(sessionId)}${small ? '-small' : ''}.jpg${imageId ? `?v=${encodeURIComponent(imageId)}` : ''}`;
}
