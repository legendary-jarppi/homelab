import { query } from '$lib/server/prometheus';
import type { ArchitectureData, WorkloadStatus } from '$lib/architecture';

type Kind = WorkloadStatus['kind'];

/**
 * A pod's workload from kube-state-metrics' owner labels: ReplicaSet "web-6d4cf79b97" → Deployment
 * "web"; Job "backup-29331330" → CronJob "backup"; StatefulSet and DaemonSet names as they are.
 */
function owner(kind: string, name: string): { kind: Kind; name: string } | null {
	if (kind === 'ReplicaSet') return { kind: 'Deployment', name: name.replace(/-[^-]+$/, '') };
	if (kind === 'Job') return { kind: 'CronJob', name: name.replace(/-\d+$/, '') };
	if (kind === 'StatefulSet' || kind === 'DaemonSet') return { kind, name };
	return null;
}

const byPod = (samples: { metric: Record<string, string>; value: number }[]) =>
	new Map(samples.map((s) => [`${s.metric.namespace}/${s.metric.pod}`, s.value]));

/** Every workload's pods with readiness, restarts in 24 h, CPU (cores) and memory (bytes), keyed "namespace/name". */
export async function workloads(): Promise<ArchitectureData['workloads']> {
	const [info, phase, ready, restarts, cpu, memory, cronjobs] = await Promise.all([
		query('kube_pod_info'),
		query('kube_pod_status_phase == 1'),
		query('kube_pod_status_ready{condition="true"}'),
		query('sum by (namespace, pod) (increase(kube_pod_container_status_restarts_total[24h]))'),
		query('sum by (namespace, pod) (rate(container_cpu_usage_seconds_total{container!=""}[5m]))'),
		query('sum by (namespace, pod) (container_memory_working_set_bytes{container!=""})'),
		query('kube_cronjob_status_last_successful_time')
	]);
	const phases = new Map(phase.map((s) => [`${s.metric.namespace}/${s.metric.pod}`, s.metric.phase]));
	const readyOf = byPod(ready);
	const restartsOf = byPod(restarts);
	const cpuOf = byPod(cpu);
	const memoryOf = byPod(memory);

	const result: ArchitectureData['workloads'] = {};
	for (const c of cronjobs) {
		result[`${c.metric.namespace}/${c.metric.cronjob}`] = { kind: 'CronJob', pods: [], lastSuccess: c.value * 1000 };
	}
	for (const { metric: m } of info) {
		const o = owner(m.created_by_kind, m.created_by_name);
		if (!o) continue;
		const pod = `${m.namespace}/${m.pod}`;
		const podPhase = phases.get(pod) ?? 'Unknown';
		// Finished job pods are history, not running parts.
		if (podPhase === 'Succeeded') continue;
		const key = `${m.namespace}/${o.name}`;
		result[key] ??= { kind: o.kind, pods: [] };
		result[key].pods.push({
			name: m.pod,
			ready: readyOf.get(pod) === 1,
			phase: podPhase,
			restarts24h: Math.round(restartsOf.get(pod) ?? 0),
			cpu: cpuOf.get(pod) ?? null,
			memory: memoryOf.get(pod) ?? null
		});
	}
	return result;
}
