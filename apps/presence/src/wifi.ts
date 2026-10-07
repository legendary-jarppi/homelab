// Wi-Fi source: phones associated with the home network, as UniFi reports them through UnPoller.
// unpoller_client_uptime_seconds exists only while a client is connected; when it leaves, the series
// ends (Prometheus marks it stale at the next scrape).
import { config } from './config.ts';

interface Result {
	metric: Record<string, string>;
	value?: [number, string];
	values?: [number, string][];
}

async function prometheus(path: string, params: Record<string, string>): Promise<Result[]> {
	const response = await fetch(new URL(path, config.prometheusUrl), {
		method: 'POST',
		body: new URLSearchParams(params),
		signal: AbortSignal.timeout(10_000)
	});
	const body = (await response.json()) as { status: string; error?: string; data?: { result: Result[] } };
	if (body.status !== 'success' || !body.data) throw new Error(`Prometheus ${path}: ${body.error ?? response.status}`);
	return body.data.result;
}

const connected = (macs: string[]) =>
	`max by (mac) (unpoller_client_uptime_seconds{source="${config.unifiSource}", mac=~"${macs.join('|')}"})`;

/** MACs connected right now. Throws when Prometheus cannot answer. */
export async function connectedNow(macs: string[]): Promise<Set<string>> {
	return new Set((await prometheus('/api/v1/query', { query: connected(macs) })).map((r) => r.metric.mac));
}

/** Per MAC, the minutes (unix seconds, one per minute) it was connected during the last `days` days. */
export async function connectedHistory(macs: string[], days: number, nowS: number): Promise<Map<string, number[]>> {
	const end = Math.floor(nowS);
	const result = await prometheus('/api/v1/query_range', {
		query: connected(macs),
		start: String(end - days * 86_400),
		end: String(end),
		step: '60'
	});
	return new Map(result.map((r) => [r.metric.mac, (r.values ?? []).map(([t]) => t)]));
}

/** First minute in the last `days` days with any UniFi client data: history before it is unknown, not empty. */
export async function historyStart(days: number, nowS: number): Promise<number | null> {
	const end = Math.floor(nowS);
	const result = await prometheus('/api/v1/query_range', {
		query: `count(unpoller_client_uptime_seconds{source="${config.unifiSource}"})`,
		start: String(end - days * 86_400),
		end: String(end),
		step: '60'
	});
	return result[0]?.values?.[0]?.[0] ?? null;
}
