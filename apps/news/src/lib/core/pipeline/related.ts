// Related stories: for each embedded article, the most similar articles published within a week
// that are not its own story (cluster). Pairs are stored symmetrically, so an article also lists
// the later ones that found it. Readers see only visible pairs (visibleTo on the related article).
import { setImmediate } from 'node:timers/promises';
import type { Sql } from '../db.ts';
import { log } from './log.ts';

/**
 * Cosine at or above which another story is related. Measured 2026-11-01 on 300 articles from the
 * last 2 days against all embedded articles within ±7 days outside their own cluster
 * (text-embedding-3-small over calm headline + summary): median best match 0.60, median 8th 0.49.
 * 0.45-0.50 pairs only share a genre (dates vs etiquette, bedbugs vs fireworks); 0.50-0.55 mostly
 * share a format (two celebrity interviews, injuries in different sports); 0.55-0.60 is the same
 * theme (Russia's return to hockey vs weightlifting world championships, two long-range weather
 * forecasts, STT funding from two angles); 0.60-0.70 the same theme or a follow-up. At 0.55 an
 * article gets 3.1 related stories on average and a third get none.
 */
export const RELATED_FLOOR = Number(process.env.RELATED_FLOOR ?? 0.55);
const MAX_RELATED = 8;
const WINDOW_MS = 7 * 86_400_000;
/** Articles published within this many days are queued (also the backfill on first deploy). */
const BACKFILL_DAYS = Number(process.env.RELATED_BACKFILL_DAYS ?? 30);
/**
 * A batch spans at most this much publication time, so the candidate window (batch span ± 7 days)
 * stays near 15 days (~8 000 vectors, ~50 MB as Float32Array) during the backfill.
 */
const BATCH_SPAN_MS = 86_400_000;

interface Story {
	id: number;
	published_at: Date;
	cluster_id: number | null;
}

export interface Neighbour extends Story {
	/** Unit length, so the dot product is the cosine. */
	vector: Float32Array;
}

export function unitVector(values: number[]): Float32Array {
	const v = Float32Array.from(values);
	let norm = 0;
	for (const x of v) norm += x * x;
	norm = Math.sqrt(norm);
	if (norm > 0) for (let i = 0; i < v.length; i++) v[i] /= norm;
	return v;
}

function dot(a: Float32Array, b: Float32Array): number {
	let s = 0;
	for (let i = 0; i < a.length; i++) s += a[i] * b[i];
	return s;
}

/**
 * The article's most similar candidates within ±7 days at or above the floor, best first: never
 * itself and never a member of its own cluster (the same event is shown as "Also in").
 */
export function relatedFor(article: Neighbour, candidates: Neighbour[], floor = RELATED_FLOOR, max = MAX_RELATED): { id: number; similarity: number }[] {
	const found: { id: number; similarity: number }[] = [];
	const at = article.published_at.getTime();
	for (const c of candidates) {
		if (c.id === article.id || (article.cluster_id !== null && c.cluster_id === article.cluster_id)) continue;
		if (Math.abs(c.published_at.getTime() - at) > WINDOW_MS) continue;
		const similarity = dot(article.vector, c.vector);
		if (similarity >= floor) found.push({ id: c.id, similarity });
	}
	return found.sort((a, b) => b.similarity - a.similarity).slice(0, max);
}

/** Condition on `articles` for the related queue (also used for the queue length in stats). */
export function relatedPending(sql: Sql) {
	return sql`embedding IS NOT NULL AND related_at IS NULL AND published_at > now() - make_interval(days => ${BACKFILL_DAYS})`;
}

/**
 * Computes related stories for up to `batch` pending articles, newest first, with one candidate
 * load for the whole batch. An article is pending once embedded, and embedding assigns its cluster
 * in the same update, so its own story is known here. Returns how many articles were processed.
 */
export async function relatePending(sql: Sql, batch = 100): Promise<number> {
	const [newest] = await sql<{ published_at: Date }[]>`
		SELECT published_at FROM articles WHERE ${relatedPending(sql)} ORDER BY published_at DESC LIMIT 1`;
	if (!newest) return 0;
	const started = Date.now();
	const pending = await sql<Story[]>`
		SELECT id, published_at, cluster_id FROM articles
		WHERE ${relatedPending(sql)} AND published_at > ${new Date(newest.published_at.getTime() - BATCH_SPAN_MS)}
		ORDER BY published_at DESC LIMIT ${batch}`;
	if (pending.length === 0) return 0;
	const times = pending.map((p) => p.published_at.getTime());
	const from = new Date(Math.min(...times) - WINDOW_MS);
	const to = new Date(Math.max(...times) + WINDOW_MS);

	// Streamed so only the Float32 copies stay in memory.
	const candidates: Neighbour[] = [];
	const cursor = sql<(Story & { embedding: number[] })[]>`
		SELECT id, published_at, cluster_id, embedding FROM articles
		WHERE embedding IS NOT NULL AND published_at BETWEEN ${from} AND ${to}`.cursor(500);
	for await (const rows of cursor) {
		for (const r of rows) candidates.push({ id: r.id, published_at: r.published_at, cluster_id: r.cluster_id, vector: unitVector(r.embedding) });
	}
	const loadMs = Date.now() - started;
	const byId = new Map(candidates.map((c) => [c.id, c]));

	// Both directions, one row per pair (a single INSERT cannot update the same row twice).
	const pairs = new Map<string, { article_id: number; related_id: number; similarity: number }>();
	const add = (a: number, b: number, similarity: number) => {
		const key = `${a}:${b}`;
		if ((pairs.get(key)?.similarity ?? -1) < similarity) pairs.set(key, { article_id: a, related_id: b, similarity });
	};
	for (const p of pending) {
		// Embedding reset by a re-classification since the first query: pending again once re-embedded.
		const article = byId.get(p.id);
		if (!article) continue;
		for (const r of relatedFor(article, candidates)) {
			add(p.id, r.id, r.similarity);
			add(r.id, p.id, r.similarity);
		}
		// ~8 000 dot products per article: let the worker's other loops and health checks run.
		await setImmediate();
	}
	const done = pending.filter((p) => byId.has(p.id)).map((p) => p.id);
	await sql.begin(async (tx) => {
		if (pairs.size > 0) {
			await tx`
				INSERT INTO article_related ${tx([...pairs.values()])}
				ON CONFLICT (article_id, related_id) DO UPDATE SET similarity = GREATEST(article_related.similarity, EXCLUDED.similarity)`;
		}
		await tx`UPDATE articles SET related_at = now() WHERE id = ANY(${done}::bigint[]) AND embedding IS NOT NULL`;
	});
	log.info('related', { count: done.length, pairs: pairs.size, candidates: candidates.length, load_ms: loadMs, ms: Date.now() - started });
	return done.length;
}
