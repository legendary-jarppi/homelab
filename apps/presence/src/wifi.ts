// Wi-Fi source: phones associated with each site's network, as its UniFi console reports them
// through UnPoller (one `source` label per console). unpoller_client_uptime_seconds exists only
// while a client is connected; when it leaves, the series ends (Prometheus marks it stale at the
// next scrape). A site with no client series at all is not reporting (console, VPN or link down):
// every site has always-connected clients.
import { z } from 'zod';
import { config, type Site } from './config.ts';

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

const connected = (site: Site, macs: string[]) =>
	`max by (mac) (unpoller_client_uptime_seconds{source="${site.unifiSource}", mac=~"${macs.join('|')}"})`;
const anyClient = (site: Site) => `count(unpoller_client_uptime_seconds{source="${site.unifiSource}"})`;

/** Per site: whether it is reporting, and which of `macs` are connected there right now. Throws when Prometheus cannot answer. */
export async function connectedNow(macs: string[]): Promise<Map<string, { reporting: boolean; macs: Set<string> }>> {
	const answers = await Promise.all(
		config.sites.map(async (site) => {
			const [clients, mine] = await Promise.all([
				prometheus('/api/v1/query', { query: anyClient(site) }),
				macs.length > 0 ? prometheus('/api/v1/query', { query: connected(site, macs) }) : Promise.resolve([])
			]);
			return [site.id, { reporting: clients.length > 0, macs: new Set(mine.flatMap((r) => r.labels.mac ?? [])) }] as const;
		})
	);
	return new Map(answers);
}

const range = (query: string, days: number, nowS: number) => {
	const end = Math.floor(nowS);
	return prometheus('/api/v1/query_range', { query, start: String(end - days * 86_400), end: String(end), step: '60' });
};

/**
 * The last `days` days, per site: which minutes (unix seconds) each of `macs` was connected there, and
 * the first and last minute with any client data (history outside them is unknown, not empty).
 */
export async function history(
	macs: string[],
	days: number,
	nowS: number
): Promise<{ connected: Map<string, { site: string; at: number }[]>; dataFrom: Map<string, number>; dataUntil: Map<string, number> }> {
	const connectedByMac = new Map<string, { site: string; at: number }[]>();
	const dataFrom = new Map<string, number>();
	const dataUntil = new Map<string, number>();
	await Promise.all(
		config.sites.map(async (site) => {
			const [mine, clients] = await Promise.all([
				macs.length > 0 ? range(connected(site, macs), days, nowS) : Promise.resolve([]),
				range(anyClient(site), days, nowS)
			]);
			for (const r of mine) {
				const mac = r.labels.mac;
				if (!mac) continue;
				const list = connectedByMac.get(mac) ?? [];
				list.push(...r.times.map((at) => ({ site: site.id, at })));
				connectedByMac.set(mac, list);
			}
			const times = clients[0]?.times ?? [];
			if (times.length > 0) {
				dataFrom.set(site.id, times[0]);
				dataUntil.set(site.id, times[times.length - 1]);
			}
		})
	);
	return { connected: connectedByMac, dataFrom, dataUntil };
}
