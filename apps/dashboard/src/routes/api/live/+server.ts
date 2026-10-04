import { json } from '@sveltejs/kit';
import { config } from '$lib/server/config';
import { query, queryRange, scalar } from '$lib/server/prometheus';
import type { LiveData, Point } from '$lib/types';
import type { RequestHandler } from './$types';

const WINDOW_S = 15 * 60;
const STEP_S = 10;

export const GET: RequestHandler = async () => {
	const S = `source="${config.unifiSource}"`;
	// UnPoller restarts briefly leave a stale duplicate of every series (differing only in `pod`);
	// `max by` collapses duplicates before summing WAN ports.
	// rate over 40 s (four 10 s scrapes): irate showed 0 whenever two scrapes returned the
	// same cached UnPoller values (7 of 180 samples measured); this window had none.
	const wanRate = (dir: 'receive' | 'transmit') =>
		`sum(max by (name, port) (rate(unpoller_device_wan_${dir}_bytes_total{${S}}[40s]))) * 8`;
	const wan24h = (dir: 'receive' | 'transmit') =>
		`sum(max by (name, port) (increase(unpoller_device_wan_${dir}_bytes_total{${S}}[24h])))`;

	const [down, up, down24h, up24h, latency, gateways, gatewayStats, clients, deviceInfo, deviceUptime, apClients, clientDown, clientUp] =
		await Promise.all([
			queryRange(wanRate('receive'), WINDOW_S, STEP_S),
			queryRange(wanRate('transmit'), WINDOW_S, STEP_S),
			scalar(wan24h('receive')),
			scalar(wan24h('transmit')),
			// UniFi reports internet latency under the "www" subsystem.
			scalar(`max(unpoller_site_latency_seconds{${S}, subsystem="www"}) * 1000`),
			query(`max by (name) (unpoller_device_uptime_seconds{${S}, type=~"udm|ugw|usg|uxg"})`),
			query(
				`label_replace(max by (name) (unpoller_device_cpu_utilization_ratio{${S}, type=~"udm|ugw|usg|uxg"}), "stat", "cpu", "", "")
				 or label_replace(max by (name) (unpoller_device_memory_utilization_ratio{${S}, type=~"udm|ugw|usg|uxg"}), "stat", "memory", "", "")
				 or label_replace(max by (name) (unpoller_device_temperature_celsius{${S}, type=~"udm|ugw|usg|uxg", temp_area="CPU"}), "stat", "temperature", "", "")`
			),
			query(`count by (wired) (max by (mac, wired) (unpoller_client_uptime_seconds{${S}}))`),
			query(`max by (name, type, model) (unpoller_device_info{${S}})`),
			query(`max by (name) (unpoller_device_uptime_seconds{${S}})`),
			query(`count by (ap_name) (max by (mac, ap_name) (unpoller_client_uptime_seconds{${S}, wired="false"}))`),
			// Client counters are from the network's side: transmit = to the client (download).
			// The UDM occasionally reports every client rate as 0 for one poll; max over 35 s bridges it.
			query(`max by (mac, name, oui, wired) (max_over_time(unpoller_client_transmit_rate_bytes{${S}}[35s]))`),
			query(`max by (mac, name, oui, wired) (max_over_time(unpoller_client_receive_rate_bytes{${S}}[35s]))`)
		]);

	const downPoints: Point[] = down[0]?.values ?? [];
	const upPoints: Point[] = up[0]?.values ?? [];

	const gatewayName = gateways[0]?.metric.name;
	const stat = (name: string) => gatewayStats.find((s) => s.metric.stat === name)?.value ?? null;

	const wiredCount = clients.find((c) => c.metric.wired === 'true')?.value ?? 0;
	const wirelessCount = clients.find((c) => c.metric.wired === 'false')?.value ?? 0;

	const uptimeByName = new Map(deviceUptime.map((d) => [d.metric.name, d.value]));
	const clientsByAp = new Map(apClients.map((a) => [a.metric.ap_name, a.value]));
	const typeOrder: Record<string, number> = { udm: 0, ugw: 0, usg: 0, uxg: 0, usw: 1, uap: 2 };
	const devices = deviceInfo
		.map((d) => ({
			name: d.metric.name,
			type: d.metric.type,
			model: d.metric.model,
			online: (uptimeByName.get(d.metric.name) ?? 0) > 0,
			clients: d.metric.type === 'uap' ? (clientsByAp.get(d.metric.name) ?? 0) : null
		}))
		.sort((a, b) => (typeOrder[a.type] ?? 9) - (typeOrder[b.type] ?? 9) || a.name.localeCompare(b.name));

	const upByMac = new Map(clientUp.map((c) => [c.metric.mac, c.value]));
	const top = clientDown
		.map((c) => ({
			mac: c.metric.mac,
			// Clients without a hostname are reported under their MAC; show the vendor instead.
			name: c.metric.name && c.metric.name !== c.metric.mac ? c.metric.name : (c.metric.oui || c.metric.mac),
			vendor: c.metric.oui ?? '',
			wired: c.metric.wired === 'true',
			downBps: c.value * 8,
			upBps: (upByMac.get(c.metric.mac) ?? 0) * 8
		}))
		.sort((a, b) => b.downBps + b.upBps - (a.downBps + a.upBps))
		.slice(0, 6);

	const body: LiveData = {
		wan: {
			down: downPoints,
			up: upPoints,
			downNow: downPoints.at(-1)?.[1] ?? null,
			upNow: upPoints.at(-1)?.[1] ?? null,
			down24h,
			up24h,
			latencyMs: latency
		},
		gateway: gatewayName
			? {
					name: gatewayName,
					cpu: stat('cpu'),
					memory: stat('memory'),
					temperatureC: stat('temperature'),
					uptimeS: gateways[0].value
				}
			: null,
		clients: { total: wiredCount + wirelessCount, wired: wiredCount, wireless: wirelessCount },
		devices,
		top,
		updatedAt: Date.now()
	};
	return json(body, { headers: { 'Cache-Control': 'no-store' } });
};
