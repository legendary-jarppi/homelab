import { json } from '@sveltejs/kit';
import { config } from '$lib/server/config';
import { query, queryRange, scalar } from '$lib/server/prometheus';
import type { SlowData } from '$lib/types';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => {
	const S = `source="${config.unifiSource}"`;
	const [speed, speedHistory, cpu, memory, disks, diskFree, uptime, cpuHistory, pods, problemPods, restarts, targetsDown] =
		await Promise.all([
			query(
				`label_replace(max(unpoller_device_speedtest_download{${S}}), "stat", "down", "", "")
				 or label_replace(max(unpoller_device_speedtest_upload{${S}}), "stat", "up", "", "")
				 or label_replace(max(unpoller_device_speedtest_latency_seconds{${S}}) * 1000, "stat", "latency", "", "")
				 or label_replace(max(unpoller_device_speedtest_rundate_seconds{${S}}), "stat", "ranAt", "", "")`
			),
			// One sample per hour for a week; each distinct run date becomes one history entry.
			queryRange(
				`label_replace(max(unpoller_device_speedtest_download{${S}}), "stat", "down", "", "")
				 or label_replace(max(unpoller_device_speedtest_upload{${S}}), "stat", "up", "", "")
				 or label_replace(max(unpoller_device_speedtest_rundate_seconds{${S}}), "stat", "ranAt", "", "")`,
				7 * 24 * 3600,
				3600
			),
			scalar(`1 - avg(rate(node_cpu_seconds_total{mode="idle"}[2m]))`),
			scalar(`1 - sum(node_memory_MemAvailable_bytes) / sum(node_memory_MemTotal_bytes)`),
			query(`max by (mountpoint) (node_filesystem_size_bytes{fstype="xfs", mountpoint=~"/|/home"})`),
			query(`max by (mountpoint) (node_filesystem_avail_bytes{fstype="xfs", mountpoint=~"/|/home"})`),
			scalar(`max(time() - node_boot_time_seconds)`),
			queryRange(`1 - avg(rate(node_cpu_seconds_total{mode="idle"}[2m]))`, 3600, 60),
			scalar(`sum(kube_pod_status_phase{phase="Running"})`),
			// Pending/Failed/Unknown pods, plus running pods that are not ready.
			scalar(
				`sum(kube_pod_status_phase{phase=~"Pending|Failed|Unknown"})
				 + (count(kube_pod_status_ready{condition="false"} == 1 and on (namespace, pod) kube_pod_status_phase{phase="Running"} == 1) or vector(0))`
			),
			scalar(`sum(increase(kube_pod_container_status_restarts_total[1h]))`),
			scalar(`count(up == 0) or vector(0)`)
		]);

	const freeByMount = new Map(diskFree.map((d) => [d.metric.mountpoint, d.value]));

	const speedStat = (name: string) => speed.find((s) => s.metric.stat === name)?.value;
	const down = speedStat('down');
	const up = speedStat('up');
	const latency = speedStat('latency');
	const ranAt = speedStat('ranAt');

	const historySeries = (name: string) => new Map(speedHistory.find((s) => s.metric.stat === name)?.values ?? []);
	const histDown = historySeries('down');
	const histUp = historySeries('up');
	const runs = new Map<number, { ranAt: number; downMbps: number; upMbps: number }>();
	for (const [t, run] of historySeries('ranAt')) {
		const downMbps = histDown.get(t);
		const upMbps = histUp.get(t);
		// A series can lack a sample at this step (e.g. during an UnPoller restart); skip, don't invent 0.
		if (!runs.has(run) && downMbps !== undefined && upMbps !== undefined) runs.set(run, { ranAt: run, downMbps, upMbps });
	}

	const body: SlowData = {
		speedtest:
			down !== undefined && up !== undefined && ranAt !== undefined
				? {
						downMbps: down,
						upMbps: up,
						latencyMs: latency ?? 0,
						ranAt,
						history: [...runs.values()].sort((a, b) => a.ranAt - b.ranAt)
					}
				: null,
		homelab: {
			cpu,
			memory,
			disks: disks
				.map((d) => ({
					mount: d.metric.mountpoint,
					sizeBytes: d.value,
					used: 1 - (freeByMount.get(d.metric.mountpoint) ?? d.value) / d.value
				}))
				.sort((a, b) => a.mount.localeCompare(b.mount)),
			uptimeS: uptime,
			cpuHistory: cpuHistory[0]?.values ?? [],
			pods: { running: pods ?? 0, problem: problemPods ?? 0, restarts1h: Math.round(restarts ?? 0) },
			targetsDown: targetsDown ?? 0
		},
		updatedAt: Date.now()
	};
	return json(body, { headers: { 'Cache-Control': 'no-store' } });
};
