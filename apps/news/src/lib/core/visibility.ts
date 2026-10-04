// The reader visibility rule, as one SQL fragment used by every article query (feeds, front page,
// sections, search, article pages, write actions). Keeping it in one place is the safety property:
// a query that does not use visibleTo() must not return articles to readers.
import type postgres from 'postgres';
import type { Sql } from './db.ts';

/**
 * Builds a tsquery string from a reader's blocked terms. Each term matches, in any of three
 * configs, at word beginnings (default) or as a whole word:
 *  - simple_unaccent: accent-insensitive literal words ("hamahakki" also hits "hämähäkki")
 *  - finnish / english: stemmed ("hämähäkki" also hits "hämähäkkejä", "hämähäkeistä")
 * Over-blocking is the accepted failure direction. Terms are reduced to letters/digits/spaces
 * before use, so tsquery operators in a term are never interpreted.
 */
export function blockedTermsQuery(sql: Sql, terms: { term: string; whole_word: boolean }[]): postgres.PendingQuery<postgres.Row[]> | null {
	const cleaned = terms
		.map((t) => ({ words: t.term.normalize('NFC').toLowerCase().replace(/[^\p{L}\p{N}\s]+/gu, ' ').trim().split(/\s+/).filter(Boolean), whole: t.whole_word }))
		.filter((t) => t.words.length > 0);
	if (cleaned.length === 0) return null;
	const parts = cleaned.flatMap(({ words, whole }) => {
		const phrase = words.map((w) => (whole ? w : `${w}:*`)).join(' <-> ');
		return ['simple_unaccent', 'finnish', 'english'].map((cfg) => sql`to_tsquery(${cfg}::regconfig, ${phrase})`);
	});
	return parts.reduce((acc, part) => sql`${acc} || ${part}`);
}

export interface Reader {
	id: number;
	/** Precomputed with blockedTermsQuery; null when the reader blocks no words. */
	blockQuery: postgres.PendingQuery<postgres.Row[]> | null;
}

/** WHERE-clause fragment: article `a` is visible to `reader`. */
export function visibleTo(sql: Sql, reader: Reader) {
	return sql`
		a.classify_state = 'done'
		AND a.content_state = 'extracted'
		AND a.body_purged_at IS NULL
		AND a.kind <> 'sponsored'
		AND NOT EXISTS (
			SELECT 1 FROM article_topics t
			JOIN user_hidden_topics h ON h.user_id = ${reader.id} AND h.topic = t.topic
			WHERE t.article_id = a.id
		)
		AND NOT EXISTS (SELECT 1 FROM user_hidden_outlets o WHERE o.user_id = ${reader.id} AND o.outlet_id = a.outlet_id)
		AND NOT EXISTS (
			SELECT 1 FROM article_effective_tags e
			JOIN user_thresholds u ON u.user_id = ${reader.id} AND u.tag = e.tag
			WHERE e.article_id = a.id AND e.intensity >= u.threshold
		)
		AND NOT EXISTS (SELECT 1 FROM user_muted m WHERE m.user_id = ${reader.id} AND m.article_id = a.id)
		${reader.blockQuery ? sql`AND NOT (coalesce(a.block_tsv, ''::tsvector) @@ (${reader.blockQuery}))` : sql``}
	`;
}

/** Loads the reader's blocked terms and returns the Reader used by visibleTo(). */
export async function loadReader(sql: Sql, userId: number): Promise<Reader> {
	const terms = await sql<{ term: string; whole_word: boolean }[]>`SELECT term, whole_word FROM user_blocked_terms WHERE user_id = ${userId}`;
	return { id: userId, blockQuery: blockedTermsQuery(sql, terms) };
}
