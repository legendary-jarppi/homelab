// Reader-facing article queries. Every query that returns articles, titles, outlet names of cluster
// members or photos goes through visibleTo() on alias `a`; there is no other path to article data.
import { error } from '@sveltejs/kit';
import type postgres from 'postgres';
import { db, type Sql } from '$lib/core/db';
import type { Block } from '$lib/core/blocks';
import { currentEdition, editionSlots, latestSlot, zonedInstant, TIME_ZONE } from '$lib/core/editions';
import type { Settings } from '$lib/core/prefs';
import { SECTIONS, TOPICS } from '$lib/core/taxonomy';
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

// ---------------------------------------------------------------------------------------------
// Editions

/** Published within this long before the cutoff to be considered for the front page. */
const EDITION_WINDOW_HOURS = 30;

export interface EditionInfo {
	label: string;
	cutoff: Date;
	nextLabel: string;
	nextAt: Date;
}

/** The current edition (recorded by the worker, or the latest scheduled slot) and the next one. */
export async function editionInfo(sql: Sql = db()): Promise<EditionInfo> {
	const now = new Date();
	const slot = latestSlot(now);
	const recorded = await currentEdition(sql);
	// The worker records editions as they fall due; until it has, the schedule decides.
	const current = recorded && recorded.cutoff >= slot.cutoff ? { cutoff: recorded.cutoff, label: recorded.label } : slot;
	const next = nextSlot(current.cutoff);
	return { label: current.label, cutoff: current.cutoff, nextLabel: next.label, nextAt: next.at };
}

function nextSlot(after: Date): { at: Date; label: string } {
	const slots = editionSlots();
	const day = localDate(after);
	for (let ahead = 0; ahead < 3; ahead++) {
		const d = new Date(Date.UTC(day.year, day.month - 1, day.day + ahead));
		for (const slot of slots) {
			const at = zonedInstant(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), slot.hour, slot.minute);
			if (at > after) return { at, label: slot.label };
		}
	}
	throw new Error('no edition slots configured');
}

function localDate(instant: Date): { year: number; month: number; day: number } {
	const parts = Object.fromEntries(
		new Intl.DateTimeFormat('en-GB', { timeZone: TIME_ZONE, year: 'numeric', month: 'numeric', day: 'numeric' })
			.formatToParts(instant)
			.map((p) => [p.type, Number(p.value)])
	);
	return { year: parts.year, month: parts.month, day: parts.day };
}

// ---------------------------------------------------------------------------------------------
// Cards

export interface Card {
	id: number;
	headline: string;
	summary: string | null;
	outlet: string;
	publishedAt: Date;
	minutes: number;
	section: string | null;
	kicker: string | null;
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
	outlet: string;
	topic: string | null;
	read: boolean;
	lead_image_id: number | null;
	cursor_ts: string;
	language: string | null;
	also_in?: string[] | null;
}

const TOPIC_LABELS: Record<string, string> = Object.fromEntries(TOPICS.map((t) => [t.key, t.label]));

export function readingMinutes(chars: number | null): number {
	return Math.max(1, Math.ceil((chars ?? 0) / 1100));
}

export function displayHeadline(settings: Settings, row: { title: string; calm_title: string | null }): string {
	return settings.calmHeadlines && row.calm_title ? row.calm_title : row.title;
}

/**
 * Card columns over `a` (visible article) joined with outlet `o`. `cursor_ts` is the list's sort
 * timestamp (published_at, or when saved) at full precision, so cursors never skip rows.
 */
function cardColumns(ctx: ReaderContext, sortedBy?: postgres.PendingQuery<postgres.Row[]>) {
	const { sql, reader } = ctx;
	return sql`
		a.id, a.title, a.calm_title, a.summary, a.published_at, a.body_chars, a.section, a.importance, a.language,
		o.name AS outlet,
		to_char(${sortedBy ?? sql`a.published_at`} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_ts,
		(SELECT t.topic FROM article_topics t
			WHERE t.article_id = a.id
				AND NOT EXISTS (SELECT 1 FROM user_hidden_topics h WHERE h.user_id = ${reader.id} AND h.topic = t.topic)
			ORDER BY t.rank LIMIT 1) AS topic,
		EXISTS (SELECT 1 FROM user_reads r WHERE r.user_id = ${reader.id} AND r.article_id = a.id) AS read,
		(SELECT i.id FROM images i WHERE i.article_id = a.id AND i.state = 'stored' AND i.path IS NOT NULL ORDER BY i.position LIMIT 1) AS lead_image_id`;
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
		publishedAt: r.published_at,
		minutes: readingMinutes(r.body_chars),
		section: r.section,
		kicker: r.topic ? (TOPIC_LABELS[r.topic] ?? null) : null,
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
// Front page and section fronts

/** One story per cluster (best visible member), ranked by importance then recency. */
async function editionStories(ctx: ReaderContext, edition: EditionInfo, section: string | null, limit: number): Promise<CardRow[]> {
	const { sql, reader } = ctx;
	return sql<CardRow[]>`
		WITH cand AS (
			SELECT a.id, a.cluster_id, a.outlet_id,
				row_number() OVER (
					PARTITION BY coalesce(a.cluster_id, -a.id)
					ORDER BY a.importance DESC NULLS LAST, a.published_at DESC, a.id DESC) AS rn
			FROM articles a
			WHERE ${visibleTo(sql, reader)}
				-- By publication time, not classification time: a story published before the cutoff
				-- belongs to that edition even when classification finishes a few minutes later
				-- (and a fresh install shows a front page at once instead of waiting for the next slot).
				AND a.published_at <= ${edition.cutoff}
				AND a.published_at > ${edition.cutoff}::timestamptz - make_interval(hours => ${EDITION_WINDOW_HOURS})
				${section ? sql`AND a.section = ${section}` : sql``}
		)
		SELECT ${cardColumns(ctx)}, also.outlets AS also_in
		FROM cand c
		JOIN articles a ON a.id = c.id
		JOIN outlets o ON o.id = a.outlet_id
		LEFT JOIN LATERAL (
			SELECT array_agg(DISTINCT o2.name ORDER BY o2.name) AS outlets
			FROM articles a JOIN outlets o2 ON o2.id = a.outlet_id
			WHERE c.cluster_id IS NOT NULL
				AND a.cluster_id = c.cluster_id
				AND a.id <> c.id
				AND a.outlet_id <> c.outlet_id
				AND ${visibleTo(sql, reader)}
		) also ON true
		WHERE c.rn = 1
		ORDER BY a.importance DESC NULLS LAST, a.published_at DESC, a.id DESC
		LIMIT ${limit}`;
}

export interface SectionBlock {
	key: string;
	label: string;
	stories: Card[];
}

export interface FrontPage {
	lead: Card | null;
	secondary: Card[];
	brief: Card[];
	sections: SectionBlock[];
}

const SECONDARY_COUNT = 3;
const BRIEF_COUNT = 8;
const PER_SECTION = 6;

export async function frontPage(ctx: ReaderContext, edition: EditionInfo): Promise<FrontPage> {
	const rows = await editionStories(ctx, edition, null, 150);
	const lead = rows.slice(0, 1);
	const secondary = rows.slice(1, 1 + SECONDARY_COUNT);
	const rest = rows.slice(1 + SECONDARY_COUNT);
	const brief = rest
		.filter((r) => (r.importance ?? 1) <= 2)
		.slice(0, BRIEF_COUNT)
		.sort((a, b) => b.published_at.getTime() - a.published_at.getTime());
	const briefIds = new Set(brief.map((r) => r.id));
	const bySection = new Map<string, CardRow[]>();
	for (const r of rest) {
		if (briefIds.has(r.id) || !r.section) continue;
		const list = bySection.get(r.section) ?? [];
		if (list.length < PER_SECTION) list.push(r);
		bySection.set(r.section, list);
	}
	const sectionTops = new Set([...bySection.values()].map((list) => list[0].id));
	const photoWanted = new Set([...lead, ...secondary].map((r) => r.id));
	const all = [...lead, ...secondary, ...brief, ...[...bySection.values()].flat()];
	const cards = await toCards(ctx, all, (r) => photoWanted.has(r.id) || sectionTops.has(r.id));
	const byId = new Map(cards.map((c) => [c.id, c]));
	const pick = (list: CardRow[]) => list.map((r) => byId.get(r.id)!);
	return {
		lead: lead.length ? byId.get(lead[0].id)! : null,
		secondary: pick(secondary),
		brief: pick(brief),
		sections: SECTIONS.filter((s) => bySection.has(s.key)).map((s) => ({ key: s.key, label: s.label, stories: pick(bySection.get(s.key)!) }))
	};
}

export function sectionLabel(key: string): string | null {
	return SECTIONS.find((s) => s.key === key)?.label ?? null;
}

export async function sectionFront(ctx: ReaderContext, edition: EditionInfo, section: string): Promise<Card[]> {
	const rows = await editionStories(ctx, edition, section, 40);
	return toCards(ctx, rows, (_, i) => i < 4);
}

/** Older section stories: published before the edition window, newest first. */
export async function sectionEarlier(ctx: ReaderContext, edition: EditionInfo, section: string, cursor: Cursor | null) {
	const { sql, reader } = ctx;
	const start = cursor ?? {
		ts: new Date(edition.cutoff.getTime() - EDITION_WINDOW_HOURS * 3600_000).toISOString().replace('Z', '000Z'),
		id: Number.MAX_SAFE_INTEGER
	};
	const rows = await sql<CardRow[]>`
		SELECT ${cardColumns(ctx)}
		FROM articles a JOIN outlets o ON o.id = a.outlet_id
		WHERE ${visibleTo(sql, reader)}
			AND a.section = ${section}
			AND (a.published_at, a.id) < (${start.ts}::timestamptz, ${start.id})
		ORDER BY a.published_at DESC, a.id DESC
		LIMIT ${PAGE_SIZE + 1}`;
	const p = page(rows, PAGE_SIZE);
	return { cards: await toCards(ctx, p.rows), next: p.next };
}

// ---------------------------------------------------------------------------------------------
// Latest, search, saved

export async function latest(ctx: ReaderContext, cursor: Cursor | null) {
	const { sql, reader } = ctx;
	const rows = await sql<CardRow[]>`
		SELECT ${cardColumns(ctx)}
		FROM articles a JOIN outlets o ON o.id = a.outlet_id
		WHERE ${visibleTo(sql, reader)}
			${cursor ? sql`AND (a.published_at, a.id) < (${cursor.ts}::timestamptz, ${cursor.id})` : sql``}
		ORDER BY a.published_at DESC, a.id DESC
		LIMIT ${PAGE_SIZE + 1}`;
	const p = page(rows, PAGE_SIZE);
	return { cards: await toCards(ctx, p.rows), next: p.next };
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
// Article page

export interface ClusterMember {
	id: number;
	outlet: string;
	headline: string;
}

export interface ArticleView {
	id: number;
	headline: string;
	originalTitle: string;
	standfirst: string | null;
	summary: string | null;
	author: string | null;
	outlet: string;
	url: string;
	language: string | null;
	publishedAt: Date;
	minutes: number;
	section: string | null;
	sectionLabel: string | null;
	kicker: string | null;
	blocks: Block[];
	/** Stored, displayable photos by position (0 = lead). */
	photos: Record<number, Photo>;
	saved: boolean;
	alsoIn: ClusterMember[];
	more: Card[];
}

/** The article if visible to this reader; otherwise the same 404 as a missing id. */
export async function article(ctx: ReaderContext, id: number): Promise<ArticleView> {
	const { sql, reader } = ctx;
	const [row] = await sql<
		(CardRow & { teaser: string | null; author: string | null; url: string; body: Block[] | null; cluster_id: number | null; outlet_id: number; saved: boolean })[]
	>`
		SELECT ${cardColumns(ctx)}, a.teaser, a.author, a.url, a.body, a.cluster_id, a.outlet_id,
			EXISTS (SELECT 1 FROM user_saved s WHERE s.user_id = ${reader.id} AND s.article_id = a.id) AS saved
		FROM articles a JOIN outlets o ON o.id = a.outlet_id
		WHERE a.id = ${id} AND ${visibleTo(sql, reader)}`;
	if (!row) error(404, 'Not found');

	const [alsoIn, moreRows, photos] = await Promise.all([
		row.cluster_id === null
			? Promise.resolve([] as { id: number; outlet: string; title: string; calm_title: string | null }[])
			: sql<{ id: number; outlet: string; title: string; calm_title: string | null }[]>`
				SELECT a.id, o.name AS outlet, a.title, a.calm_title
				FROM articles a JOIN outlets o ON o.id = a.outlet_id
				WHERE a.cluster_id = ${row.cluster_id} AND a.id <> ${row.id} AND ${visibleTo(sql, reader)}
				ORDER BY a.published_at DESC
				LIMIT 8`,
		row.section === null
			? Promise.resolve([] as CardRow[])
			: sql<CardRow[]>`
				SELECT ${cardColumns(ctx)}
				FROM articles a JOIN outlets o ON o.id = a.outlet_id
				WHERE ${visibleTo(sql, reader)}
					AND a.section = ${row.section}
					AND a.id <> ${row.id}
					${row.cluster_id === null ? sql`` : sql`AND a.cluster_id IS DISTINCT FROM ${row.cluster_id}`}
					AND a.published_at > now() - interval '3 days'
				ORDER BY a.importance DESC NULLS LAST, a.published_at DESC
				LIMIT 4`,
		articlePhotos(ctx, row.id)
	]);

	return {
		id: row.id,
		headline: displayHeadline(ctx.settings, row),
		originalTitle: row.title,
		standfirst: row.teaser,
		summary: row.summary,
		author: row.author,
		outlet: row.outlet,
		url: row.url,
		language: row.language,
		publishedAt: row.published_at,
		minutes: readingMinutes(row.body_chars),
		section: row.section,
		sectionLabel: row.section ? sectionLabel(row.section) : null,
		kicker: row.topic ? (TOPIC_LABELS[row.topic] ?? null) : null,
		blocks: row.body ?? [],
		photos,
		saved: row.saved,
		alsoIn: alsoIn.map((m) => ({ id: m.id, outlet: m.outlet, headline: displayHeadline(ctx.settings, m) })),
		more: await toCards(ctx, moreRows)
	};
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
