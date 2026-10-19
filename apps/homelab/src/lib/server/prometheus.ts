import { env } from '$env/dynamic/private';

// Prometheus HTTP API (ported from apps/dashboard). In the cluster:
// http://kube-prometheus-stack-prometheus.monitoring.svc:9090; in development http://prometheus.lab.internal.
const prometheusUrl = env.PROMETHEUS_URL ?? 'http://prometheus.lab.internal';

export interface Sample {
	metric: Record<string, string>;
	value: number;
}

async function request(path: string, params: Record<string, string>): Promise<unknown> {
	const url = new URL(path, prometheusUrl);
	const response = await fetch(url, {
		method: 'POST',
		body: new URLSearchParams(params),
		signal: AbortSignal.timeout(8000)
	});
	const body = await response.json();
	if (body.status !== 'success') throw new Error(`Prometheus ${path}: ${body.error ?? response.status}`);
	return body.data.result;
}

/** Instant query. NaN/Inf samples are dropped. */
export async function query(expr: string): Promise<Sample[]> {
	const result = (await request('/api/v1/query', { query: expr })) as { metric: Record<string, string>; value: [number, string] }[];
	return result
		.map((r) => ({ metric: r.metric, value: Number(r.value[1]) }))
		.filter((s) => Number.isFinite(s.value));
}

/** First sample's value, or null when the query returns nothing. */
export async function scalar(expr: string): Promise<number | null> {
	return (await query(expr))[0]?.value ?? null;
}
