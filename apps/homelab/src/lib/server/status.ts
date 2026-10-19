import { domainToUnicode } from 'node:url';
import { COMPONENTS, SITES, type ArchitectureData, type SiteId } from '$lib/architecture';
import { query, scalar } from './prometheus';
import { workloads } from './workloads';

// Jobs of the backup CronJob (platform/components/backup), scheduled or started by hand, except the
// `restic-shell` job its README uses for browsing the repository (same as apps/dashboard).
const BACKUP_JOBS = `namespace="backup", job_name!~"restic-shell.*"`;

const siteOf = (source: string | undefined) => (Object.keys(SITES) as SiteId[]).find((s) => SITES[s].console === source);

/** Every device check in the model, once. */
const CHECKS = [...new Set(COMPONENTS.groups.flatMap((g) => g.nodes.flatMap((n) => n.device?.checks?.map((c) => c.expr) ?? [])))];

/** UniFi shows some host names as DNS labels; "xn--jrvi-saunalta-bfb" → "järvi-saunalta". */
const hostName = (name: string) => (name.startsWith('xn--') ? domainToUnicode(name) || name : name);

/** Everything live for Overview, Components and Devices, from Prometheus. Throws when Prometheus fails. */
export async function getStatus(): Promise<ArchitectureData> {
	const [pods, consoles, clients, gear, gearUptime, node, nodeReady, uptimeS, cpu, memory, targetsDown, backupSuccess, backupFailure, backupActive, checks] =
		await Promise.all([
			workloads(),
			query('up{job="unpoller"}'),
			query('unpoller_client_uptime_seconds'),
			query('unpoller_device_info'),
			query('unpoller_device_uptime_seconds'),
			query('kube_node_info'),
			scalar('min(kube_node_status_condition{condition="Ready", status="true"})'),
			scalar('max(time() - node_boot_time_seconds)'),
			scalar('1 - avg(rate(node_cpu_seconds_total{mode="idle"}[2m]))'),
			scalar('1 - sum(node_memory_MemAvailable_bytes) / sum(node_memory_MemTotal_bytes)'),
			scalar('count(up == 0) or vector(0)'),
			scalar(`max(kube_job_status_completion_time{${BACKUP_JOBS}} and on (job_name) (kube_job_status_succeeded{${BACKUP_JOBS}} > 0))`),
			scalar(`max(kube_job_status_start_time{${BACKUP_JOBS}} and on (job_name) (kube_job_failed{${BACKUP_JOBS}, condition="true"} == 1))`),
			scalar(`sum(kube_job_status_active{${BACKUP_JOBS}})`),
			Promise.all(CHECKS.map((expr) => scalar(expr)))
		]);

	const consoleUp = (site: SiteId) => {
		const sample = consoles.find((s) => s.metric.instance === SITES[site].console);
		return sample ? sample.value === 1 : null;
	};
	const uptimeOf = new Map(gearUptime.map((s) => [`${s.metric.source}/${s.metric.mac}`, s.value]));

	return {
		workloads: pods,
		consoles: { home: consoleUp('home'), cabin: consoleUp('cabin') },
		clients: clients.flatMap(({ metric: m, value }) => {
			const site = siteOf(m.source);
			if (!site) return [];
			const wired = m.wired === 'true';
			return [
				{
					site,
					name: hostName(m.name ?? m.mac),
					mac: m.mac,
					ip: m.ip ?? '',
					wired,
					via: wired ? `${m.sw_name ?? 'switch'} port ${m.sw_port ?? '?'}` : `${m.ap_name ?? 'Wi-Fi'}${m.essid ? ` · ${m.essid}` : ''}`,
					uptimeS: value
				}
			];
		}),
		gear: gear.flatMap(({ metric: m }) => {
			const site = siteOf(m.source);
			if (!site) return [];
			return [{ site, name: m.name, model: m.model, ip: m.ip, mac: m.mac, uptimeS: uptimeOf.get(`${m.source}/${m.mac}`) ?? null }];
		}),
		checks: Object.fromEntries(
			CHECKS.flatMap((expr, i): [string, number][] => {
				const value = checks[i];
				return value === null ? [] : [[expr, value]];
			})
		),
		cluster: {
			node: node[0]?.metric.node ?? null,
			nodeReady: nodeReady === null ? null : nodeReady === 1,
			kubelet: node[0]?.metric.kubelet_version ?? null,
			uptimeS,
			cpu,
			memory,
			targetsDown,
			backup: { lastSuccess: backupSuccess, lastFailure: backupFailure, running: (backupActive ?? 0) > 0 }
		},
		updatedAt: Date.now()
	};
}
