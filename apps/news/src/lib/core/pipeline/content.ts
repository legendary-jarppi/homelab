// Content queue: fetches and extracts pending articles into our block model, stores photos, and
// hands extracted articles to classification. Every outcome is recorded on the article row.
import { blocksText } from '../blocks.ts';
import type { Sql } from '../db.ts';
import { FetchError } from '../http.ts';
import { deleteArticleImages, storeArticleImages } from '../images.ts';
import { outletBySlug } from '../outlets/index.ts';
import { ExtractError } from '../outlets/types.ts';
import { errorText, log } from './log.ts';

const MAX_ATTEMPTS = Number(process.env.CONTENT_MAX_ATTEMPTS ?? 5);
/** Shorter bodies are briefs, video pages or teasers: not an article we can deliver. */
const MIN_BODY_CHARS = Number(process.env.CONTENT_MIN_CHARS ?? 300);

export interface ContentJob {
	id: number;
	url: string;
	outletId: number;
	slug: string;
	attempts: number;
}

/**
 * Next pending article by outlet priority, then newest. `exclude` = articles in flight;
 * `busyOutlets` = outlets already at their in-flight cap (per-host pacing would only queue them).
 */
export async function nextContentJob(sql: Sql, exclude: number[], busyOutlets: number[]): Promise<ContentJob | null> {
	const [row] = await sql<ContentJob[]>`
		SELECT a.id, a.url, a.outlet_id AS "outletId", o.slug, a.content_attempts AS attempts
		FROM articles a JOIN outlets o ON o.id = a.outlet_id
		WHERE a.content_state = 'pending' AND a.content_next_at <= now() AND a.body_purged_at IS NULL AND o.enabled
			AND a.id <> ALL(${exclude}::bigint[]) AND a.outlet_id <> ALL(${busyOutlets}::int[])
		ORDER BY o.priority DESC, a.published_at DESC
		LIMIT 1`;
	return row ?? null;
}

type Outcome = { state: 'extracted' | 'paywalled' | 'skipped' | 'failed'; reason?: string } | { retry: string };
type ExtractOutcome = Outcome & { images?: { stored: number; failed: number }; chars?: number };

/** Transient failures are retried with backoff; anything permanent is recorded at once. */
function classifyError(e: unknown): Outcome {
	if (e instanceof ExtractError) return { state: e.state, reason: errorText(e) };
	if (e instanceof FetchError) {
		if (e.kind === 'robots') return { state: 'skipped', reason: 'disallowed by robots.txt' };
		if (e.kind === 'network') return { retry: errorText(e) };
		if (e.kind === 'http' && (e.status === 429 || e.status === 403 || (e.status ?? 0) >= 500)) return { retry: errorText(e) };
		return { state: 'failed', reason: errorText(e) };
	}
	// Unexpected errors (a changed page shape breaking a parser) are retried a few times, then failed.
	return { retry: errorText(e) };
}

async function extractOne(sql: Sql, job: ContentJob): Promise<ExtractOutcome> {
	const def = outletBySlug(job.slug);
	if (!def) return { state: 'failed', reason: `no extractor for outlet ${job.slug}` };
	const article = await def.extract(job.url);
	const meta = article.meta ?? {};
	if (article.paywalled) {
		await sql`
			UPDATE articles SET content_state = 'paywalled', content_reason = 'paywalled', source_meta = ${sql.json(meta as never)},
				extracted_at = now()
			WHERE id = ${job.id}`;
		return { state: 'paywalled' };
	}
	const chars = blocksText(article.blocks).length;
	if (chars < MIN_BODY_CHARS) return { state: 'skipped', reason: `too little text (${chars} chars)`, chars };

	// Replace the photo rows and files from any earlier extraction, then download the new set.
	await sql.begin(async (tx) => {
		await tx`DELETE FROM images WHERE article_id = ${job.id}`;
		const rows = article.images.map((i) => ({
			article_id: job.id,
			position: i.position,
			source_url: i.url,
			caption: i.caption?.trim() || null,
			credit: i.credit?.trim() || null,
			alt: i.alt?.trim() || null
		}));
		if (rows.length > 0) await tx`INSERT INTO images ${tx(rows, 'article_id', 'position', 'source_url', 'caption', 'credit', 'alt')} ON CONFLICT (article_id, position) DO NOTHING`;
	});
	await deleteArticleImages(job.id);
	const images = await storeArticleImages(sql, job.id);

	await sql`
		UPDATE articles SET
			content_state = 'extracted', content_reason = NULL, extracted_at = now(),
			title = COALESCE(NULLIF(${article.title.trim()}, ''), title),
			teaser = COALESCE(${article.lead?.trim() || null}, teaser),
			author = ${article.author?.trim() || null},
			language = ${article.language ?? def.language},
			published_at = COALESCE(${article.publishedAt ?? null}, published_at),
			body = ${sql.json(article.blocks as never)},
			body_chars = ${chars},
			source_meta = ${sql.json(meta as never)},
			-- New content must be (re)classified before it is shown again.
			classify_state = 'pending', classify_attempts = 0, classify_next_at = now(), classify_error = NULL,
			embedding = NULL
		WHERE id = ${job.id} AND body_purged_at IS NULL`;
	return { state: 'extracted', images, chars };
}

/** Extracts one article and records the outcome; never throws. */
export async function processContent(sql: Sql, job: ContentJob): Promise<void> {
	const started = Date.now();
	let outcome: ExtractOutcome;
	try {
		outcome = await extractOne(sql, job);
	} catch (e) {
		outcome = classifyError(e);
	}
	const ms = Date.now() - started;
	try {
		if ('retry' in outcome) {
			const attempts = job.attempts + 1;
			if (attempts >= MAX_ATTEMPTS) {
				await sql`UPDATE articles SET content_state = 'failed', content_reason = ${outcome.retry}, content_attempts = ${attempts} WHERE id = ${job.id}`;
				log.warn('extract-failed', { id: job.id, outlet: job.slug, attempts, ms, error: outcome.retry });
			} else {
				// 2, 4, 8, 16 minutes.
				const delayS = 60 * 2 ** attempts;
				await sql`
					UPDATE articles SET content_attempts = ${attempts}, content_reason = ${outcome.retry},
						content_next_at = now() + make_interval(secs => ${delayS})
					WHERE id = ${job.id}`;
				log.warn('extract-retry', { id: job.id, outlet: job.slug, attempts, ms, error: outcome.retry });
			}
			return;
		}
		if (outcome.state === 'extracted') {
			log.info('extracted', { id: job.id, outlet: job.slug, chars: outcome.chars, images: outcome.images?.stored, image_failures: outcome.images?.failed, ms });
			return;
		}
		if (outcome.state !== 'paywalled') {
			await sql`UPDATE articles SET content_state = ${outcome.state}, content_reason = ${outcome.reason ?? null} WHERE id = ${job.id}`;
		}
		log.info(`content-${outcome.state}`, { id: job.id, outlet: job.slug, ms, reason: outcome.reason });
	} catch (e) {
		log.error('content-record-failed', { id: job.id, error: errorText(e) });
	}
}
