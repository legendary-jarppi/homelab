// Reader-facing article queries. Every query that returns articles, titles, outlet names of cluster
// members, entities' stories or photos goes through visibleTo() on alias `a`; there is no other path
// to article data.
import { error } from '@sveltejs/kit';
import type postgres from 'postgres';
import { db, type Sql } from '$lib/core/db';
import type { Block } from '$lib/core/blocks';
import type { Settings } from '$lib/core/prefs';
import { SECTIONS } from '$lib/core/taxonomy';
import { loadReader, visibleTo, type Reader } from '$lib/core/visibility';
import { articlePhotos, photosByIds, type Photo } from './photos';

/** Per-request reader state, loaded once. */
export interface ReaderContext {
	sql: Sql;
	reader: Reader;
	settings: Settings;
	/** tag -> threshold (1..3); absent = never hides. */
	thresholds: Map<string, number>;
}

const contexts = new WeakMap<App.Locals, Promise<ReaderContext>>();

export function readerContext(locals: App.Locals): Promise<ReaderContext> {
	const user = locals.user;
	if (!user) error(404, 'Not found');
	let ctx = contexts.get(locals);
	if (!ctx) {
		const sql = db();
		ctx = Promise.all([
			loadReader(sql, user.id),
			sql<{ tag: string; threshold: number }[]>`SELECT tag, threshold FROM user_thresholds WHERE user_id = ${user.id}`
		]).then(([reader, rows]) => ({ sql, reader, settings: locals.settings, thresholds: new Map(rows.map((r) => [r.tag, r.threshold])) }));
		contexts.set(locals, ctx);
	}
	return ctx;
}

/** When the newest story entered the paper (classified), for the masthead. Not reader-specific. */
export async function lastUpdate(sql: Sql = db()): Promise<Date | null> {
	const [row] = await sql<{ at: Date | null }[]>`SELECT max(classified_at) AS at FROM articles WHERE classify_state = 'done'`;
	return row?.at ?? null;
}

/** Enabled papers this reader has not hidden, for the navigation. */
export async function paperLinks(sql: Sql, userId: number): Promise<{ slug: string; name: string }[]> {
	return sql<{ slug: string; name: string }[]>`
		SELECT o.slug, o.name FROM outlets o
		WHERE o.enabled AND NOT EXISTS (SELECT 1 FROM user_hidden_outlets h WHERE h.user_id = ${userId} AND h.outlet_id = o.id)
		ORDER BY o.name`;
}

// ---------------------------------------------------------------------------------------------
// Cards

export interface Card {
	id: number;
	headline: string;
	summary: string | null;
	outlet: string;
	outletSlug: string;
	publishedAt: Date;
	minutes: number;
	section: string | null;
	/** Primary topic key the reader has not hidden (shown as the kicker). */
	topic: string | null;
	importance: number;
	/** Article language (calm headline and summary are written in it). */
	language: string | null;
	read: boolean;
	photo: Photo | null;
	/** Outlet names of other visible members of the story cluster. */
	alsoIn: string[];
}

interface CardRow {
	id: number;
	title: string;
	calm_title: string | null;
	summary: string | null;
	published_at: Date;
	body_chars: number | null;
	section: string | null;
	importance: number | null;
	cluster_id: number | null;
	outlet: string;
	outlet_slug: string;
	topic: string | null;
	read: boolean;
	lead_image_id: number | null;
	cursor_ts: string;
	language: string | null;
	also_in?: string[] | null;
}

export function readingMinutes(chars: number | null): number {
	return Math.max(1, Math.ceil((chars ?? 0) / 1100));
}

export function displayHeadline(settings: Settings, row: { title: string; calm_title: string | null }): string {
	return settings.calmHeadlines && row.calm_title ? row.calm_title : row.title;
}

/** One key per story: the cluster, or the article itself when it has none. */
const storyKey = (r: { id: number; cluster_id: number | null }) => r.cluster_id ?? -r.id;

/**
 * Card columns over `a` (visible article) joined with outlet `o`. `cursor_ts` is the list's sort
 * timestamp (published_at, or when saved) at full precision, so cursors never skip rows.
 */
function cardColumns(ctx: ReaderContext, sortedBy?: postgres.PendingQuery<postgres.Row[]>) {
	const { sql, reader } = ctx;
	return sql`
		a.id, a.title, a.calm_title, a.summary, a.published_at, a.body_chars, a.section, a.importance, a.language, a.cluster_id,
		o.name AS outlet, o.slug AS outlet_slug,
		to_char(${sortedBy ?? sql`a.published_at`} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_ts,
		(SELECT t.topic FROM article_topics t
			WHERE t.article_id = a.id
				AND NOT EXISTS (SELECT 1 FROM user_hidden_topics h WHERE h.user_id = ${reader.id} AND h.topic = t.topic)
			ORDER BY t.rank LIMIT 1) AS topic,
		EXISTS (SELECT 1 FROM user_reads r WHERE r.user_id = ${reader.id} AND r.article_id = a.id) AS read,
		(SELECT i.id FROM images i WHERE i.article_id = a.id AND i.state = 'stored' AND i.path IS NOT NULL ORDER BY i.position LIMIT 1) AS lead_image_id`;
}

/** Outlet names of the other visible members of `cluster` (lateral join, outer alias `a`). */
function alsoInColumn(ctx: ReaderContext) {
	const { sql, reader } = ctx;
	return sql`
		LEFT JOIN LATERAL (
			SELECT array_agg(DISTINCT o2.name ORDER BY o2.name) AS outlets
			FROM articles cm JOIN outlets o2 ON o2.id = cm.outlet_id
			WHERE a.cluster_id IS NOT NULL
				AND cm.cluster_id = a.cluster_id
				AND cm.id <> a.id
				AND cm.outlet_id <> a.outlet_id
				AND ${visibleTo(sql, reader, 'cm')}
		) also ON true`;
}

/** Turns rows into cards; lead photos (if wanted) in one query for the whole list. */
async function toCards(ctx: ReaderContext, rows: CardRow[], withPhotos: (row: CardRow, index: number) => boolean = () => false): Promise<Card[]> {
	const photoIds = rows.filter((r, i) => r.lead_image_id !== null && withPhotos(r, i)).map((r) => r.lead_image_id as number);
	const photos = await photosByIds(ctx, photoIds);
	return rows.map((r) => ({
		id: r.id,
		headline: displayHeadline(ctx.settings, r),
		summary: r.summary,
		outlet: r.outlet,
		outletSlug: r.outlet_slug,
		publishedAt: r.published_at,
		minutes: readingMinutes(r.body_chars),
		section: r.section,
		topic: r.topic,
		importance: r.importance ?? 1,
		language: r.language,
		read: r.read,
		photo: r.lead_image_id !== null ? (photos.get(r.lead_image_id) ?? null) : null,
		alsoIn: r.also_in ?? []
	}));
}

// ---------------------------------------------------------------------------------------------
// Cursor pagination over (published_at, id) or (saved_at, id)

export interface Cursor {
	ts: string;
	id: number;
}

const CURSOR_RE = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z)~(\d{1,18})$/;

export function parseCursor(raw: string | null): Cursor | null {
	const m = raw?.match(CURSOR_RE);
	return m ? { ts: m[1], id: Number(m[2]) } : null;
}

export function formatCursor(c: Cursor): string {
	return `${c.ts}~${c.id}`;
}

export const PAGE_SIZE = 30;

function page(rows: CardRow[], size: number): { rows: CardRow[]; next: string | null } {
	const more = rows.length > size;
	const kept = rows.slice(0, size);
	const last = kept.at(-1);
	return { rows: kept, next: more && last ? formatCursor({ ts: last.cursor_ts, id: last.id }) : null };
}

// ---------------------------------------------------------------------------------------------
// Live ranking: front page, section fronts, a paper's top stories

/** Stories published within this many hours compete for the front page and section tops. */
export const WINDOW_HOURS = 36;
/** One importance point is worth this many hours of age. */
const HOURS_PER_POINT = 6;
/** Score bonus per natural-log unit of outlets covering the story (2 outlets +0.55, 4 outlets +1.1). */
const COVERAGE_WEIGHT = 0.8;

/**
 * One story per cluster (its most important visible member), ranked by
 *   importance + COVERAGE_WEIGHT * ln(outlets covering it) - hours since its newest report / HOURS_PER_POINT
 * so a big story stays up while it develops, a story many papers report rises, and everything
 * else gives way to fresher news. Coverage counts only members this reader can see.
 */
async function ranked(ctx: ReaderContext, opts: { limit: number; section?: string; outletId?: number }): Promise<CardRow[]> {
	const { sql, reader } = ctx;
	return sql<CardRow[]>`
		SELECT ${cardColumns(ctx)}, also.outlets AS also_in
		FROM (
			WITH vis AS (
				SELECT a.id, a.cluster_id, a.outlet_id, a.importance, a.published_at, a.section
				FROM articles a
				WHERE ${visibleTo(sql, reader)}
					AND a.published_at > now() - make_interval(hours => ${WINDOW_HOURS})
					AND a.published_at <= now() + interval '15 minutes'
			),
			coverage AS (
				SELECT coalesce(cluster_id, -id) AS story, count(DISTINCT outlet_id) AS outlets, max(published_at) AS newest
				FROM vis GROUP BY 1
			),
			cand AS (
				SELECT v.id, v.cluster_id, v.importance,
					row_number() OVER (
						PARTITION BY coalesce(v.cluster_id, -v.id)
						ORDER BY v.importance DESC NULLS LAST, v.published_at DESC, v.id DESC) AS rn
				FROM vis v
				WHERE true
					${opts.section ? sql`AND v.section = ${opts.section}` : sql``}
					${opts.outletId !== undefined ? sql`AND v.outlet_id = ${opts.outletId}` : sql``}
			)
			SELECT c.id,
				coalesce(c.importance, 1)
					+ ${COVERAGE_WEIGHT} * ln(cv.outlets)
					- greatest(0, extract(epoch FROM now() - cv.newest)) / 3600.0 / ${HOURS_PER_POINT} AS score
			FROM cand c JOIN coverage cv ON cv.story = coalesce(c.cluster_id, -c.id)
			WHERE c.rn = 1
			ORDER BY score DESC, c.id DESC
			LIMIT ${opts.limit}
		) top
		JOIN articles a ON a.id = top.id
		JOIN outlets o ON o.id = a.outlet_id
		${alsoInColumn(ctx)}
		ORDER BY top.score DESC, a.id DESC`;
}

/** Newest visible stories, one per cluster, skipping the given stories. */
async function newest(ctx: ReaderContext, count: number, skip: Set<number>): Promise<CardRow[]> {
	const { sql, reader } = ctx;
	const rows = await sql<CardRow[]>`
		SELECT ${cardColumns(ctx)}, also.outlets AS also_in
		FROM articles a JOIN outlets o ON o.id = a.outlet_id
		${alsoInColumn(ctx)}
		WHERE ${visibleTo(sql, reader)} AND a.published_at <= now() + interval '15 minutes'
		ORDER BY a.published_at DESC, a.id DESC
		LIMIT ${count * 4}`;
	const seen = new Set(skip);
	const out: CardRow[] = [];
	for (const r of rows) {
		if (seen.has(storyKey(r))) continue;
		seen.add(storyKey(r));
		out.push(r);
		if (out.length === count) break;
	}
	return out;
}

export interface SectionBlock {
	key: string;
	stories: Card[];
}

export interface PaperBlock {
	slug: string;
	name: string;
	stories: Card[];
}

export interface FrontPage {
	lead: Card | null;
	secondary: Card[];
	/** What just came in, newest first (not repeating the top stories). */
	latest: Card[];
	sections: SectionBlock[];
	papers: PaperBlock[];
}

const SECONDARY_COUNT = 3;
const LATEST_COUNT = 10;
const PER_SECTION = 5;
const PER_PAPER = 3;

export async function frontPage(ctx: ReaderContext): Promise<FrontPage> {
	const [pool, papers] = await Promise.all([ranked(ctx, { limit: 200 }), paperTops(ctx, PER_PAPER)]);
	const top = pool.slice(0, 1 + SECONDARY_COUNT);
	const latest = await newest(ctx, LATEST_COUNT, new Set(top.map(storyKey)));
	const taken = new Set([...top, ...latest].map((r) => r.id));
	const bySection = new Map<string, CardRow[]>();
	for (const r of pool.slice(top.length)) {
		if (taken.has(r.id) || !r.section) continue;
		const list = bySection.get(r.section) ?? [];
		if (list.length < PER_SECTION) list.push(r);
		bySection.set(r.section, list);
	}
	const sectionTops = new Set([...bySection.values()].map((list) => list[0].id));
	const photoWanted = new Set(top.map((r) => r.id));
	const all = [...top, ...latest, ...[...bySection.values()].flat()];
	const cards = await toCards(ctx, all, (r) => photoWanted.has(r.id) || sectionTops.has(r.id));
	const byId = new Map(cards.map((c) => [c.id, c]));
	const pick = (list: CardRow[]) => list.map((r) => byId.get(r.id)!);
	return {
		lead: top.length ? byId.get(top[0].id)! : null,
		secondary: pick(top.slice(1)),
		latest: pick(latest),
		sections: SECTIONS.filter((s) => bySection.has(s.key)).map((s) => ({ key: s.key, stories: pick(bySection.get(s.key)!) })),
		papers
	};
}

/**
 * Each paper's top stories of the past day (importance, then freshness), for the front page's
 * "By paper" block and the Papers page. Papers the reader hid, or with nothing visible, are left out.
 */
async function paperTops(ctx: ReaderContext, perPaper: number): Promise<PaperBlock[]> {
	const { sql, reader } = ctx;
	const rows = await sql<CardRow[]>`
		SELECT ${cardColumns(ctx)}
		FROM (
			SELECT a.id, row_number() OVER (
				PARTITION BY a.outlet_id
				ORDER BY coalesce(a.importance, 1) - extract(epoch FROM now() - a.published_at) / 3600.0 / ${HOURS_PER_POINT} DESC, a.id DESC) AS rn
			FROM articles a
			WHERE ${visibleTo(sql, reader)}
				AND a.published_at > now() - interval '24 hours'
				AND a.published_at <= now() + interval '15 minutes'
		) x
		JOIN articles a ON a.id = x.id
		JOIN outlets o ON o.id = a.outlet_id
		WHERE x.rn <= ${perPaper} AND o.enabled
		ORDER BY o.name, x.rn`;
	const cards = await toCards(ctx, rows);
	const blocks = new Map<string, PaperBlock>();
	for (const card of cards) {
		const block = blocks.get(card.outletSlug) ?? { slug: card.outletSlug, name: card.outlet, stories: [] };
		block.stories.push(card);
		blocks.set(card.outletSlug, block);
	}
	return [...blocks.values()];
}

export function isSection(key: string): boolean {
	return SECTIONS.some((s) => s.key === key);
}

export async function sectionFront(ctx: ReaderContext, section: string): Promise<Card[]> {
	const rows = await ranked(ctx, { limit: 40, section });
	return toCards(ctx, rows, (_, i) => i < 4);
}

/** Older section stories: published before the ranking window, newest first. */
export async function sectionEarlier(ctx: ReaderContext, section: string, cursor: Cursor | null) {
	const { sql, reader } = ctx;
	const rows = await sql<CardRow[]>`
		SELECT ${cardColumns(ctx)}
		FROM articles a JOIN outlets o ON o.id = a.outlet_id
		WHERE ${visibleTo(sql, reader)}
			AND a.section = ${section}
			${
				cursor
					? sql`AND (a.published_at, a.id) < (${cursor.ts}::timestamptz, ${cursor.id})`
					: sql`AND a.published_at <= now() - make_interval(hours => ${WINDOW_HOURS})`
			}
		ORDER BY a.published_at DESC, a.id DESC
		LIMIT ${PAGE_SIZE + 1}`;
	const p = page(rows, PAGE_SIZE);
	return { cards: await toCards(ctx, p.rows), next: p.next };
}

// ---------------------------------------------------------------------------------------------
// Latest, papers, search, saved

/** Newest first; `outletId` limits it to one paper (Papers page). */
export async function latest(ctx: ReaderContext, cursor: Cursor | null, outletId?: number) {
	const { sql, reader } = ctx;
	const rows = await sql<CardRow[]>`
		SELECT ${cardColumns(ctx)}, also.outlets AS also_in
		FROM articles a JOIN outlets o ON o.id = a.outlet_id
		${alsoInColumn(ctx)}
		WHERE ${visibleTo(sql, reader)}
			${outletId !== undefined ? sql`AND a.outlet_id = ${outletId}` : sql``}
			${cursor ? sql`AND (a.published_at, a.id) < (${cursor.ts}::timestamptz, ${cursor.id})` : sql``}
		ORDER BY a.published_at DESC, a.id DESC
		LIMIT ${PAGE_SIZE + 1}`;
	const p = page(rows, PAGE_SIZE);
	return { cards: await toCards(ctx, p.rows), next: p.next };
}

export interface Paper {
	id: number;
	slug: string;
	name: string;
	homepage: string;
	/** Hidden by this reader in Settings → Papers: none of its stories are shown anywhere. */
	hidden: boolean;
}

/** Enabled papers, alphabetically. */
export async function papers(ctx: ReaderContext): Promise<Paper[]> {
	const { sql, reader } = ctx;
	return sql<Paper[]>`
		SELECT o.id, o.slug, o.name, o.homepage,
			EXISTS (SELECT 1 FROM user_hidden_outlets h WHERE h.user_id = ${reader.id} AND h.outlet_id = o.id) AS hidden
		FROM outlets o
		WHERE o.enabled
		ORDER BY o.name`;
}

/** The Papers page: every enabled paper with its top stories of the past day (no counts). */
export async function newsstand(ctx: ReaderContext): Promise<(Paper & { stories: Card[] })[]> {
	const [all, tops] = await Promise.all([papers(ctx), paperTops(ctx, 4)]);
	const bySlug = new Map(tops.map((b) => [b.slug, b.stories]));
	return all.map((p) => ({ ...p, stories: p.hidden ? [] : (bySlug.get(p.slug) ?? []) }));
}

/** A paper's most important stories right now (its own front page). */
export async function paperFront(ctx: ReaderContext, outletId: number): Promise<Card[]> {
	const rows = await ranked(ctx, { limit: 5, outletId });
	return toCards(ctx, rows, (_, i) => i < 3);
}

export const SEARCH_LIMIT = 40;

/** Ranked full-text search; capped, no pagination. */
export async function search(ctx: ReaderContext, query: string): Promise<Card[]> {
	const q = query.trim().slice(0, 200);
	if (!q) return [];
	const { sql, reader } = ctx;
	const rows = await sql<CardRow[]>`
		WITH q AS (
			SELECT websearch_to_tsquery('finnish', ${q}) || websearch_to_tsquery('english', ${q})
				|| websearch_to_tsquery('simple_unaccent', ${q}) AS q
		)
		SELECT ${cardColumns(ctx)}
		FROM q, articles a JOIN outlets o ON o.id = a.outlet_id
		WHERE ${visibleTo(sql, reader)}
			AND a.search_tsv @@ q.q
		ORDER BY ts_rank_cd(a.search_tsv, q.q) DESC, a.published_at DESC, a.id DESC
		LIMIT ${SEARCH_LIMIT}`;
	return toCards(ctx, rows);
}

export async function saved(ctx: ReaderContext, cursor: Cursor | null) {
	const { sql, reader } = ctx;
	const rows = await sql<CardRow[]>`
		SELECT ${cardColumns(ctx, sql`s.created_at`)}
		FROM user_saved s
		JOIN articles a ON a.id = s.article_id
		JOIN outlets o ON o.id = a.outlet_id
		WHERE s.user_id = ${reader.id}
			AND ${visibleTo(sql, reader)}
			${cursor ? sql`AND (s.created_at, a.id) < (${cursor.ts}::timestamptz, ${cursor.id})` : sql``}
		ORDER BY s.created_at DESC, a.id DESC
		LIMIT ${PAGE_SIZE + 1}`;
	const p = page(rows, PAGE_SIZE);
	return { cards: await toCards(ctx, p.rows), next: p.next };
}

// ---------------------------------------------------------------------------------------------
// People and things (entities)

export type EntityKind = 'person' | 'organisation' | 'place' | 'other';

export interface Entity {
	id: number;
	name: string;
	kind: EntityKind;
}

/**
 * An entity and its visible stories, newest first. An entity none of whose stories this reader
 * can see answers with the same 404 as a missing one.
 */
export async function entityPage(ctx: ReaderContext, id: number, cursor: Cursor | null) {
	const { sql, reader } = ctx;
	const [entity] = await sql<Entity[]>`SELECT id, name, kind FROM entities WHERE id = ${id}`;
	if (!entity) error(404, 'Not found');
	const rows = await sql<CardRow[]>`
		SELECT ${cardColumns(ctx)}, also.outlets AS also_in
		FROM article_entities ae
		JOIN articles a ON a.id = ae.article_id
		JOIN outlets o ON o.id = a.outlet_id
		${alsoInColumn(ctx)}
		WHERE ae.entity_id = ${id}
			AND ${visibleTo(sql, reader)}
			${cursor ? sql`AND (a.published_at, a.id) < (${cursor.ts}::timestamptz, ${cursor.id})` : sql``}
		ORDER BY a.published_at DESC, a.id DESC
		LIMIT ${PAGE_SIZE + 1}`;
	if (rows.length === 0 && !cursor) error(404, 'Not found');
	const p = page(rows, PAGE_SIZE);
	return { entity, cards: await toCards(ctx, p.rows, (_, i) => !cursor && i < 3), next: p.next };
}

// ---------------------------------------------------------------------------------------------
// Article page

export interface StoryLink {
	id: number;
	headline: string;
	outlet: string;
	outletSlug: string;
	language: string | null;
	publishedAt: Date;
}

export interface EntityStories extends Entity {
	/** Other visible stories about it, newest first; not this story's cluster, not one listed under an earlier entity (may be empty). */
	stories: StoryLink[];
}

export interface ArticleView {
	id: number;
	headline: string;
	originalTitle: string;
	standfirst: string | null;
	summary: string | null;
	author: string | null;
	outlet: string;
	outletSlug: string;
	url: string;
	language: string | null;
	publishedAt: Date;
	minutes: number;
	section: string | null;
	topic: string | null;
	blocks: Block[];
	/** Stored, displayable photos by position (0 = lead). */
	photos: Record<number, Photo>;
	saved: boolean;
	/** The same story in other papers (visible cluster members). */
	alsoIn: (StoryLink & { minutes: number })[];
	related: Card[];
	entities: EntityStories[];
	moreSection: Card[];
	morePaper: Card[];
	/** The highest-ranked story the reader has not read yet, to read next. */
	next: Card | null;
}

const ENTITY_STORIES = 3;

/** The article if visible to this reader; otherwise the same 404 as a missing id. */
export async function article(ctx: ReaderContext, id: number): Promise<ArticleView> {
	const { sql, reader } = ctx;
	const [row] = await sql<(CardRow & { teaser: string | null; author: string | null; url: string; body: Block[] | null; outlet_id: number; saved: boolean })[]>`
		SELECT ${cardColumns(ctx)}, a.teaser, a.author, a.url, a.body, a.outlet_id,
			EXISTS (SELECT 1 FROM user_saved s WHERE s.user_id = ${reader.id} AND s.article_id = a.id) AS saved
		FROM articles a JOIN outlets o ON o.id = a.outlet_id
		WHERE a.id = ${id} AND ${visibleTo(sql, reader)}`;
	if (!row) error(404, 'Not found');
	const notThisStory = row.cluster_id === null ? sql`a.id <> ${row.id}` : sql`a.id <> ${row.id} AND a.cluster_id IS DISTINCT FROM ${row.cluster_id}`;

	const [alsoIn, relatedRows, entities, sectionRows, paperRows, pool, photos] = await Promise.all([
		row.cluster_id === null
			? Promise.resolve([] as CardRow[])
			: sql<CardRow[]>`
				SELECT ${cardColumns(ctx)}
				FROM articles a JOIN outlets o ON o.id = a.outlet_id
				WHERE a.cluster_id = ${row.cluster_id} AND a.id <> ${row.id} AND ${visibleTo(sql, reader)}
				ORDER BY a.published_at DESC
				LIMIT 12`,
		sql<CardRow[]>`
			SELECT ${cardColumns(ctx)}
			FROM article_related r
			JOIN articles a ON a.id = r.related_id
			JOIN outlets o ON o.id = a.outlet_id
			WHERE r.article_id = ${row.id} AND ${notThisStory} AND ${visibleTo(sql, reader)}
			ORDER BY r.similarity DESC
			LIMIT 12`,
		articleEntities(ctx, row.id, notThisStory),
		row.section === null
			? Promise.resolve([] as CardRow[])
			: sql<CardRow[]>`
				SELECT ${cardColumns(ctx)}
				FROM articles a JOIN outlets o ON o.id = a.outlet_id
				WHERE ${visibleTo(sql, reader)}
					AND a.section = ${row.section}
					AND ${notThisStory}
					AND a.published_at > now() - interval '3 days'
				ORDER BY a.importance DESC NULLS LAST, a.published_at DESC
				LIMIT 4`,
		sql<CardRow[]>`
			SELECT ${cardColumns(ctx)}
			FROM articles a JOIN outlets o ON o.id = a.outlet_id
			WHERE ${visibleTo(sql, reader)}
				AND a.outlet_id = ${row.outlet_id}
				AND ${notThisStory}
			ORDER BY a.published_at DESC, a.id DESC
			LIMIT 4`,
		ranked(ctx, { limit: 30 }),
		articlePhotos(ctx, row.id)
	]);

	// Related: one per story, never one already shown as "Also in".
	const seen = new Set([storyKey(row)]);
	const related = relatedRows
		.filter((r) => {
			if (seen.has(storyKey(r))) return false;
			seen.add(storyKey(r));
			return true;
		})
		.slice(0, 5);
	const nextRow = pool.find((r) => !r.read && storyKey(r) !== storyKey(row));
	const [relatedCards, sectionCards, paperCards, nextCards] = await Promise.all([
		toCards(ctx, related, () => true),
		toCards(ctx, sectionRows),
		toCards(ctx, paperRows),
		toCards(ctx, nextRow ? [nextRow] : [], () => true)
	]);

	return {
		id: row.id,
		headline: displayHeadline(ctx.settings, row),
		originalTitle: row.title,
		standfirst: row.teaser,
		summary: row.summary,
		author: row.author,
		outlet: row.outlet,
		outletSlug: row.outlet_slug,
		url: row.url,
		language: row.language,
		publishedAt: row.published_at,
		minutes: readingMinutes(row.body_chars),
		section: row.section,
		topic: row.topic,
		blocks: row.body ?? [],
		photos,
		saved: row.saved,
		alsoIn: alsoIn.map((m) => ({ ...storyLink(ctx, m), minutes: readingMinutes(m.body_chars) })),
		related: relatedCards,
		entities,
		moreSection: sectionCards,
		morePaper: paperCards,
		next: nextCards[0] ?? null
	};
}

function storyLink(ctx: ReaderContext, r: CardRow): StoryLink {
	return { id: r.id, headline: displayHeadline(ctx.settings, r), outlet: r.outlet, outletSlug: r.outlet_slug, language: r.language, publishedAt: r.published_at };
}

/**
 * The article's entities, most central first, each with its newest other visible stories; a story
 * is listed under the first entity that has it. Entities with no other visible story are left
 * out: their page would hold only this article.
 */
async function articleEntities(ctx: ReaderContext, articleId: number, notThisStory: postgres.PendingQuery<postgres.Row[]>): Promise<EntityStories[]> {
	const { sql, reader } = ctx;
	const list = await sql<Entity[]>`
		SELECT e.id, e.name, e.kind FROM article_entities ae JOIN entities e ON e.id = ae.entity_id
		WHERE ae.article_id = ${articleId}
		ORDER BY ae.rank`;
	const perEntity = await Promise.all(
		list.map(
			(entity) => sql<CardRow[]>`
				SELECT ${cardColumns(ctx)}
				FROM article_entities ae
				JOIN articles a ON a.id = ae.article_id
				JOIN outlets o ON o.id = a.outlet_id
				WHERE ae.entity_id = ${entity.id} AND ${notThisStory} AND ${visibleTo(sql, reader)}
				ORDER BY a.published_at DESC, a.id DESC
				LIMIT ${ENTITY_STORIES * 4}`
		)
	);
	const shown = new Set<number>();
	const out: EntityStories[] = [];
	list.forEach((entity, n) => {
		const rows = perEntity[n];
		if (rows.length === 0) return;
		const stories: StoryLink[] = [];
		for (const r of rows) {
			if (stories.length === ENTITY_STORIES) break;
			if (shown.has(storyKey(r))) continue;
			shown.add(storyKey(r));
			stories.push(storyLink(ctx, r));
		}
		out.push({ ...entity, stories });
	});
	return out;
}

export async function markRead(ctx: ReaderContext, id: number): Promise<void> {
	await ctx.sql`
		INSERT INTO user_reads (user_id, article_id) VALUES (${ctx.reader.id}, ${id})
		ON CONFLICT (user_id, article_id) DO UPDATE SET read_at = now()`;
}

// ---------------------------------------------------------------------------------------------
// Reader actions. A hidden article answers exactly like a missing one.

export function parseId(raw: string): number {
	if (!/^\d{1,15}$/.test(raw)) error(404, 'Not found');
	return Number(raw);
}

async function requireVisible(ctx: ReaderContext, id: number): Promise<void> {
	const { sql, reader } = ctx;
	const rows = await sql`SELECT 1 FROM articles a WHERE a.id = ${id} AND ${visibleTo(sql, reader)}`;
	if (rows.length === 0) error(404, 'Not found');
}

export async function save(ctx: ReaderContext, id: number, on: boolean): Promise<void> {
	await requireVisible(ctx, id);
	if (on) await ctx.sql`INSERT INTO user_saved (user_id, article_id) VALUES (${ctx.reader.id}, ${id}) ON CONFLICT DO NOTHING`;
	else await ctx.sql`DELETE FROM user_saved WHERE user_id = ${ctx.reader.id} AND article_id = ${id}`;
}

export async function mute(ctx: ReaderContext, id: number): Promise<void> {
	await requireVisible(ctx, id);
	await ctx.sql`INSERT INTO user_muted (user_id, article_id) VALUES (${ctx.reader.id}, ${id}) ON CONFLICT DO NOTHING`;
}

export async function report(ctx: ReaderContext, id: number): Promise<void> {
	await requireVisible(ctx, id);
	await ctx.sql.begin(async (tx) => {
		await tx`INSERT INTO reports (user_id, article_id) VALUES (${ctx.reader.id}, ${id})`;
		await tx`INSERT INTO user_muted (user_id, article_id) VALUES (${ctx.reader.id}, ${id}) ON CONFLICT DO NOTHING`;
	});
}

/**
 * Undoes "Not for me". Only a mute the reader made can be undone, and only if the article would
 * then be visible again; otherwise the mute stays and the answer is the usual 404.
 */
export async function unmute(ctx: ReaderContext, id: number): Promise<void> {
	const { reader } = ctx;
	const restored = await ctx.sql
		.begin(async (tx) => {
			const deleted = await tx`DELETE FROM user_muted WHERE user_id = ${reader.id} AND article_id = ${id} RETURNING 1`;
			const reported = await tx`SELECT 1 FROM reports WHERE user_id = ${reader.id} AND article_id = ${id} AND resolved_at IS NULL`;
			const visible = await tx`SELECT 1 FROM articles a WHERE a.id = ${id} AND ${visibleTo(tx as unknown as Sql, reader)}`;
			if (deleted.length === 0 || reported.length > 0 || visible.length === 0) throw new Rollback();
			return true;
		})
		.catch((e) => {
			if (e instanceof Rollback) return false;
			throw e;
		});
	if (!restored) error(404, 'Not found');
}

class Rollback extends Error {}
