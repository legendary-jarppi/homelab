import { config } from './config';
import type { Point } from '$lib/types';

export interface Sample {
	metric: Record<string, string>;
	value: number;
}

export interface Series {
	metric: Record<string, string>;
	values: Point[];
}

async function request(path: string, params: Record<string, string>): Promise<unknown> {
	const url = new URL(path, config.prometheusUrl);
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

export async function queryRange(expr: string, rangeS: number, stepS: number): Promise<Series[]> {
	const end = Math.floor(Date.now() / 1000);
	const result = (await request('/api/v1/query_range', {
		query: expr,
		start: String(end - rangeS),
		end: String(end),
		step: String(stepS)
	})) as { metric: Record<string, string>; values: [number, string][] }[];
	return result.map((r) => ({
		metric: r.metric,
		values: r.values.map(([t, v]): Point => [t, Number(v)]).filter(([, v]) => Number.isFinite(v))
	}));
}
