// Wi-Fi source: phones associated with the home network, as UniFi reports them through UnPoller.
// unpoller_client_uptime_seconds exists only while a client is connected; when it leaves, the series
// ends (Prometheus marks it stale at the next scrape).
import { z } from 'zod';
import { config } from './config.ts';

/** Samples are [unix seconds, "value"]; instant queries carry one `value`, range queries `values`. */
const Sample = z.tuple([z.number(), z.string()]);
const PrometheusResponse = z.discriminatedUnion('status', [
	z.object({
		status: z.literal('success'),
		data: z.object({
			result: z.array(z.object({ metric: z.record(z.string(), z.string()), value: Sample.optional(), values: z.array(Sample).optional() }))
		})
	}),
	z.object({ status: z.literal('error'), error: z.string() })
]);

/** A series reduced to what presence uses: labels and sample timestamps. */
interface Series {
	labels: Record<string, string>;
	times: number[];
}

async function prometheus(path: string, params: Record<string, string>): Promise<Series[]> {
	const response = await fetch(new URL(path, config.prometheusUrl), {
		method: 'POST',
		body: new URLSearchParams(params),
		signal: AbortSignal.timeout(10_000)
	});
	const parsed = PrometheusResponse.safeParse(await response.json());
	if (!parsed.success) throw new Error(`Prometheus ${path}: unexpected response (HTTP ${response.status})`);
	const body = parsed.data;
	if (body.status === 'error') throw new Error(`Prometheus ${path}: ${body.error}`);
	return body.data.result.map((r) => ({ labels: r.metric, times: (r.values ?? (r.value ? [r.value] : [])).map(([t]) => t) }));
}

const connected = (macs: string[]) =>
	`max by (mac) (unpoller_client_uptime_seconds{source="${config.unifiSource}", mac=~"${macs.join('|')}"})`;

/** MACs connected right now. Throws when Prometheus cannot answer. */
export async function connectedNow(macs: string[]): Promise<Set<string>> {
	if (macs.length === 0) return new Set();
	return new Set((await prometheus('/api/v1/query', { query: connected(macs) })).flatMap((r) => r.labels.mac ?? []));
}

/** Per MAC, the minutes (unix seconds, one per minute) it was connected during the last `days` days. */
export async function connectedHistory(macs: string[], days: number, nowS: number): Promise<Map<string, number[]>> {
	if (macs.length === 0) return new Map();
	const end = Math.floor(nowS);
	const result = await prometheus('/api/v1/query_range', {
		query: connected(macs),
		start: String(end - days * 86_400),
		end: String(end),
		step: '60'
	});
	return new Map(result.flatMap((r) => (r.labels.mac ? [[r.labels.mac, r.times] as const] : [])));
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
	return result[0]?.times[0] ?? null;
}
