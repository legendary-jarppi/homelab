// Classification queue: one model call per extracted article (text + stored photos), persisted in
// one transaction together with the search vectors. Unclassified articles are never visible, so a
// failure here only delays an article; it never exposes one.
import type { Block } from '../blocks.ts';
import { blocksText, classify, PROMPT_VERSION, type ClassifyInput, type ClassifyResult } from '../classify.ts';
import type { Sql } from '../db.ts';
import { classifierJpeg } from '../images.ts';
import { LlmError, type LlmConfig } from '../llm.ts';
import { INTENSITIES, TOPICS, type Intensity } from '../taxonomy.ts';
import { errorText, log } from './log.ts';

const MAX_ATTEMPTS = Number(process.env.CLASSIFY_MAX_ATTEMPTS ?? 5);

export interface ClassifyJob {
	id: number;
	slug: string;
	attempts: number;
}

export async function nextClassifyJob(sql: Sql, exclude: number[]): Promise<ClassifyJob | null> {
	const [row] = await sql<ClassifyJob[]>`
		SELECT a.id, o.slug, a.classify_attempts AS attempts
		FROM articles a JOIN outlets o ON o.id = a.outlet_id
		WHERE a.content_state = 'extracted' AND a.classify_state = 'pending' AND a.classify_next_at <= now()
			AND a.body_purged_at IS NULL AND a.id <> ALL(${exclude}::bigint[])
		ORDER BY o.priority DESC, a.published_at DESC
		LIMIT 1`;
	return row ?? null;
}

interface ArticleRow {
	title: string;
	teaser: string | null;
	published_at: Date;
	body: Block[];
	outlet: string;
}

interface ImageRow {
	id: number;
	position: number;
	caption: string | null;
	credit: string | null;
	alt: string | null;
	state: string;
	path: string | null;
}

/** The classifier input for a stored article (photos as classifier JPEGs), or null if it has no body. */
export async function loadClassifyInput(sql: Sql, id: number): Promise<{ input: ClassifyInput; images: ImageRow[] } | null> {
	const [article] = await sql<ArticleRow[]>`
		SELECT a.title, a.teaser, a.published_at, a.body, o.name AS outlet
		FROM articles a JOIN outlets o ON o.id = a.outlet_id WHERE a.id = ${id} AND a.body IS NOT NULL`;
	if (!article) return null;
	const images = await sql<ImageRow[]>`
		SELECT id, position, caption, credit, alt, state, path FROM images WHERE article_id = ${id} ORDER BY position`;
	const withJpeg = await Promise.all(
		images.map(async (i) => {
			let jpeg: Buffer | null = null;
			if (i.state === 'stored' && i.path) {
				try {
					jpeg = await classifierJpeg(i.path);
				} catch (e) {
					// Not sent = not assessed: the photo stays behind "Show photo" for every reader.
					log.warn('classifier-image-unreadable', { id, image: i.id, error: errorText(e) });
				}
			}
			return { position: i.position, caption: i.caption, credit: i.credit, alt: i.alt, jpeg };
		})
	);
	return {
		input: { outlet: article.outlet, title: article.title, lead: article.teaser, publishedAt: article.published_at, blocks: article.body, images: withJpeg },
		images
	};
}

const intensityValue = (i: Intensity) => INTENSITIES.indexOf(i) + 1;

async function persist(sql: Sql, id: number, input: ClassifyInput, images: ImageRow[], result: ClassifyResult): Promise<void> {
	const titles = [input.title, result.calmTitle].join('\n');
	const standfirst = [result.summary, input.lead].filter(Boolean).join('\n');
	const body = [blocksText(input.blocks), ...input.images.flatMap((i) => [i.caption, i.alt]).filter(Boolean)].join('\n');
	// Blocked words match everything a reader could read on the article page.
	const blocked = [titles, standfirst, body].join('\n');
	const section = TOPICS.find((t) => t.key === result.topics[0].topic)?.section ?? 'news';
	const imageIdByPosition = new Map(images.map((i) => [i.position, i.id]));
	const assessedIds = result.assessed.map((p) => imageIdByPosition.get(p)).filter((x): x is number => x !== undefined);

	await sql.begin(async (tx) => {
		await tx`DELETE FROM article_topics WHERE article_id = ${id}`;
		await tx`INSERT INTO article_topics ${tx(
			result.topics.map((t, rank) => ({ article_id: id, topic: t.topic, rank, confidence: t.confidence }))
		)}`;
		// Manual (admin) rows are kept; they override AI rows in article_effective_tags.
		await tx`DELETE FROM article_tags WHERE article_id = ${id} AND origin = 'ai'`;
		if (result.tags.length > 0) {
			await tx`INSERT INTO article_tags ${tx(
				result.tags.map((t) => ({ article_id: id, tag: t.tag, origin: 'ai', intensity: intensityValue(t.intensity), confidence: t.confidence, basis: t.basis }))
			)}`;
		}
		if (assessedIds.length > 0) {
			await tx`DELETE FROM image_tags WHERE image_id = ANY(${assessedIds}::bigint[])`;
			const rows = new Map<string, { image_id: number; tag: string; intensity: number }>();
			for (const [position, tags] of result.imageTags) {
				const imageId = imageIdByPosition.get(position);
				if (imageId === undefined) continue;
				for (const t of tags) {
					const key = `${imageId}:${t.tag}`;
					const intensity = intensityValue(t.intensity);
					if ((rows.get(key)?.intensity ?? 0) < intensity) rows.set(key, { image_id: imageId, tag: t.tag, intensity });
				}
			}
			if (rows.size > 0) await tx`INSERT INTO image_tags ${tx([...rows.values()])}`;
			await tx`UPDATE images SET assessed = true WHERE id = ANY(${assessedIds}::bigint[])`;
		}
		await tx`
			UPDATE articles SET
				classify_state = 'done', classify_error = NULL, classified_at = now(),
				model = ${result.call.model}, prompt_version = ${PROMPT_VERSION},
				calm_title = ${result.calmTitle}, summary = ${result.summary}, importance = ${result.importance},
				kind = ${result.kind}, language = ${result.language}, section = ${section},
				-- Re-embedded (and possibly clustered) from the new calm title and summary.
				embedding = NULL,
				-- Must match tests/visibility.test.ts and the blocked-term query in visibility.ts.
				block_tsv = to_tsvector('simple_unaccent', ${blocked}::text) || to_tsvector('finnish', ${blocked}::text)
					|| to_tsvector('english', ${blocked}::text),
				search_tsv =
					setweight(to_tsvector('finnish', ${titles}::text) || to_tsvector('english', ${titles}::text) || to_tsvector('simple_unaccent', ${titles}::text), 'A')
					|| setweight(to_tsvector('finnish', ${standfirst}::text) || to_tsvector('english', ${standfirst}::text) || to_tsvector('simple_unaccent', ${standfirst}::text), 'B')
					|| setweight(to_tsvector('finnish', ${body}::text) || to_tsvector('english', ${body}::text) || to_tsvector('simple_unaccent', ${body}::text), 'C')
			WHERE id = ${id}`;
	});
}

async function recordCall(sql: Sql, row: { articleId: number; model: string; ok: boolean; latencyMs: number; input?: number | null; output?: number | null; cached?: number | null; error?: string }) {
	await sql`
		INSERT INTO llm_calls (article_id, model, ok, latency_ms, input_tokens, output_tokens, cache_read_tokens, error)
		VALUES (${row.articleId}, ${row.model}, ${row.ok}, ${row.latencyMs}, ${row.input ?? null}, ${row.output ?? null}, ${row.cached ?? null}, ${row.error ?? null})`;
}

/** Result of one classification attempt, for the queue to react to (pausing on auth/quota errors). */
export type ClassifyOutcome = 'done' | 'retry' | 'failed' | 'paused' | 'gone';

/** Classifies one article and records the outcome. Throws only on database errors. */
export async function processClassify(sql: Sql, config: LlmConfig, job: ClassifyJob): Promise<ClassifyOutcome> {
	const loaded = await loadClassifyInput(sql, job.id);
	if (!loaded) return 'gone';
	const started = Date.now();
	let result: ClassifyResult;
	try {
		result = await classify(config, loaded.input);
	} catch (e) {
		const latencyMs = Date.now() - started;
		const error = errorText(e);
		await recordCall(sql, { articleId: job.id, model: config.model, ok: false, latencyMs, error });
		if (e instanceof LlmError && e.permanent) {
			// Auth or quota: an operator must act. Do not burn the article's attempts.
			log.error('classify-paused', { id: job.id, model: config.model, error });
			return 'paused';
		}
		const attempts = job.attempts + 1;
		if (attempts >= MAX_ATTEMPTS) {
			await sql`UPDATE articles SET classify_state = 'failed', classify_attempts = ${attempts}, classify_error = ${error} WHERE id = ${job.id}`;
			log.warn('classify-failed', { id: job.id, outlet: job.slug, attempts, ms: latencyMs, error });
			return 'failed';
		}
		// 4, 8, 16, 32 minutes.
		const delayS = 120 * 2 ** attempts;
		await sql`
			UPDATE articles SET classify_attempts = ${attempts}, classify_error = ${error},
				classify_next_at = now() + make_interval(secs => ${delayS})
			WHERE id = ${job.id}`;
		log.warn('classify-retry', { id: job.id, outlet: job.slug, attempts, ms: latencyMs, error });
		return 'retry';
	}
	const { call } = result;
	await recordCall(sql, { articleId: job.id, model: call.model, ok: true, latencyMs: call.latencyMs, input: call.inputTokens, output: call.outputTokens, cached: call.cacheReadTokens });
	await persist(sql, job.id, loaded.input, loaded.images, result);
	log.info('classified', {
		id: job.id,
		outlet: job.slug,
		model: call.model,
		ms: call.latencyMs,
		in: call.inputTokens,
		out: call.outputTokens,
		cached: call.cacheReadTokens,
		photos: result.assessed.length,
		tags: result.tags.length,
		importance: result.importance
	});
	return 'done';
}
