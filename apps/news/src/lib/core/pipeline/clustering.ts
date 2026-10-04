// Story clustering: embeds calm headline + summary of classified articles and joins an article to
// the most similar story from another outlet published within 48 hours. Clustering only
// de-duplicates the front page; an article is visible whether or not it is embedded or clustered.
import type { Sql } from '../db.ts';
import { errorText, log } from './log.ts';

export const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL ?? 'text-embedding-3-small';

/**
 * Cosine similarity at or above which two articles from different outlets are the same story.
 * Measured 2026-10-04 on 289 classified articles from 7 outlets (29 167 cross-outlet pairs within
 * 48 h; text-embedding-3-small over calm headline + summary). Median pair ~0.22, 99th percentile
 * ~0.52. >= 0.80: the same report (e.g. three Norway shooting reports 0.83-0.88, G7 fuel reserves
 * 0.81). 0.70-0.80: the same event from another angle (rally title decided / driver crashed out,
 * Helsinki sea object found / expert assessment, wind warnings). 0.60-0.70 mixes those with
 * different stories on the same theme (two unrelated court sentences 0.68, G7 reserves vs Trump on
 * diesel 0.68, two weather forecasts 0.61). A false merge hides a distinct story from the front
 * page, a missed merge only repeats one, so the threshold sits at the top of the mixed band.
 * (An earlier probe gave 0.69 for one fi/en same-story pair: cross-language pairs mostly stay apart.)
 */
export const CLUSTER_THRESHOLD = Number(process.env.CLUSTER_THRESHOLD ?? 0.7);
const WINDOW_HOURS = 48;

export interface EmbeddingConfig {
	baseUrl: string;
	apiKey: string;
	model: string;
}

/** OpenAI-compatible embeddings through the AI proxy; one vector per input, in order. */
export async function embed(config: EmbeddingConfig, inputs: string[]): Promise<number[][]> {
	const response = await fetch(`${config.baseUrl}/embeddings`, {
		method: 'POST',
		headers: { authorization: `Bearer ${config.apiKey}`, 'content-type': 'application/json' },
		body: JSON.stringify({ model: config.model, input: inputs }),
		signal: AbortSignal.timeout(60_000)
	});
	if (!response.ok) throw new Error(`embeddings HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`);
	const json = (await response.json()) as { data?: { index: number; embedding: number[] }[] };
	const data = json.data ?? [];
	if (data.length !== inputs.length) throw new Error(`embeddings: expected ${inputs.length} vectors, got ${data.length}`);
	return [...data].sort((a, b) => a.index - b.index).map((d) => d.embedding);
}

export function cosine(a: number[], b: number[]): number {
	let dot = 0;
	let na = 0;
	let nb = 0;
	for (let i = 0; i < a.length; i++) {
		dot += a[i] * b[i];
		na += a[i] * a[i];
		nb += b[i] * b[i];
	}
	return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

interface Story {
	id: number;
	outlet_id: number;
	published_at: Date;
	cluster_id: number | null;
}

interface Candidate extends Story {
	embedding: number[];
}

/** The most similar story from another outlet within the time window, if above the threshold. */
export function bestMatch(article: Story, vector: number[], candidates: Candidate[]): { match: Candidate; similarity: number } | null {
	let match: Candidate | null = null;
	let similarity = 0;
	const windowMs = WINDOW_HOURS * 3600_000;
	for (const c of candidates) {
		if (c.outlet_id === article.outlet_id || c.id === article.id) continue;
		if (Math.abs(c.published_at.getTime() - article.published_at.getTime()) > windowMs) continue;
		const s = cosine(vector, c.embedding);
		if (s > similarity) {
			similarity = s;
			match = c;
		}
	}
	return match && similarity >= CLUSTER_THRESHOLD ? { match, similarity } : null;
}

/**
 * Embeds up to `batch` classified articles without an embedding and clusters them.
 * Returns how many were processed; throws when the embedding call fails (caller backs off).
 */
export async function embedPending(sql: Sql, config: EmbeddingConfig, batch = 32): Promise<number> {
	const pending = await sql<(Story & { calm_title: string | null; summary: string | null })[]>`
		SELECT id, outlet_id, published_at, cluster_id, calm_title, summary FROM articles
		WHERE classify_state = 'done' AND embedding IS NULL AND kind <> 'sponsored'
		ORDER BY classified_at DESC LIMIT ${batch}`;
	if (pending.length === 0) return 0;
	const started = Date.now();
	const vectors = await embed(config, pending.map((p) => [p.calm_title, p.summary].filter(Boolean).join('\n')));
	const embedMs = Date.now() - started;

	const times = pending.map((p) => p.published_at.getTime());
	const from = new Date(Math.min(...times) - WINDOW_HOURS * 3600_000);
	const to = new Date(Math.max(...times) + WINDOW_HOURS * 3600_000);
	const candidates = await sql<Candidate[]>`
		SELECT id, outlet_id, published_at, cluster_id, embedding FROM articles
		WHERE classify_state = 'done' AND embedding IS NOT NULL AND published_at BETWEEN ${from} AND ${to}`;

	let clustered = 0;
	// Sequential: each article sees the clusters formed by the ones before it.
	for (const [i, article] of pending.entries()) {
		const vector = vectors[i];
		const found = article.cluster_id === null ? bestMatch(article, vector, candidates) : null;
		// cluster_id = the cluster's first article: the match's cluster, or the earlier of the pair.
		const clusterId = found ? (found.match.cluster_id ?? Math.min(found.match.id, article.id)) : article.cluster_id;
		await sql.begin(async (tx) => {
			if (found && found.match.cluster_id === null) await tx`UPDATE articles SET cluster_id = ${clusterId} WHERE id = ${found.match.id}`;
			await tx`UPDATE articles SET embedding = ${vector}::real[], cluster_id = ${clusterId} WHERE id = ${article.id}`;
		});
		if (found) {
			found.match.cluster_id = clusterId;
			clustered++;
		}
		candidates.push({ id: article.id, outlet_id: article.outlet_id, published_at: article.published_at, cluster_id: clusterId, embedding: vector });
	}
	log.info('embedded', { count: pending.length, clustered, embed_ms: embedMs, ms: Date.now() - started });
	return pending.length;
}
