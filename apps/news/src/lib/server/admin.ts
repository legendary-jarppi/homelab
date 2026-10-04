// Admin queries. Admin views are deliberately unfiltered (no visibleTo): admins review hidden
// content on purpose. Every route under /admin is admin-only (hooks.server.ts).
import { randomBytes } from 'node:crypto';
import { error } from '@sveltejs/kit';
import type postgres from 'postgres';
import { hashPassword } from '$lib/core/auth';
import type { Block } from '$lib/core/blocks';
import type { Sql } from '$lib/core/db';
import { deleteArticleImages } from '$lib/core/images';
import { TAG_KEYS } from '$lib/core/taxonomy';

/** The signed-in admin's id (hooks already return 404 to everyone else). */
export function adminIdOf(locals: App.Locals): number {
	if (locals.user?.role !== 'admin') error(404, 'Not found');
	return locals.user.id;
}

// ---------------------------------------------------------------------------------------------
// Outlets

const CONTENT_STATES = ['pending', 'extracted', 'paywalled', 'failed', 'skipped'] as const;
const CLASSIFY_STATES = ['pending', 'done', 'failed'] as const;

export interface WindowStats {
	total: number;
	content: Record<(typeof CONTENT_STATES)[number], number>;
	/** Classification states of extracted articles only (others are never classified). */
	classify: Record<(typeof CLASSIFY_STATES)[number], number>;
	paywalledShare: number | null;
}

export interface OutletRow {
	id: number;
	slug: string;
	name: string;
	language: string;
	enabled: boolean;
	priority: number;
	requires_auth: boolean;
	last_discovery_at: Date | null;
	last_discovery_error: string | null;
	last_discovery_found: number | null;
	last_discovery_new: number | null;
	windows: { '24h': WindowStats; '7d': WindowStats };
	failedReasons: { reason: string; n: number }[];
	/** Subscriber session (worker secret COOKIES_<SLUG>); null = none configured. */
	session: { state: 'unknown' | 'ok' | 'rejected'; stateAt: Date | null; updatedAt: Date } | null;
}

const emptyWindow = (): WindowStats => ({
	total: 0,
	content: Object.fromEntries(CONTENT_STATES.map((s) => [s, 0])) as WindowStats['content'],
	classify: Object.fromEntries(CLASSIFY_STATES.map((s) => [s, 0])) as WindowStats['classify'],
	paywalledShare: null
});

export async function outletRows(sql: Sql): Promise<OutletRow[]> {
	const [outlets, counts, reasons, sessions] = await Promise.all([
		sql<Omit<OutletRow, 'windows' | 'failedReasons' | 'session'>[]>`
			SELECT id, slug, name, language, enabled, priority, requires_auth, last_discovery_at, last_discovery_error,
				last_discovery_found, last_discovery_new
			FROM outlets ORDER BY enabled DESC, priority DESC, name`,
		sql<{ outlet_id: number; win: '24h' | '7d'; content_state: string; classify_state: string; n: number }[]>`
			SELECT a.outlet_id, w.win, a.content_state, a.classify_state, count(*)::int AS n
			FROM articles a
			JOIN (VALUES ('24h', interval '24 hours'), ('7d', interval '7 days')) AS w(win, span) ON a.discovered_at > now() - w.span
			WHERE a.discovered_at > now() - interval '7 days'
			GROUP BY 1, 2, 3, 4`,
		sql<{ outlet_id: number; reason: string; n: number }[]>`
			SELECT outlet_id, reason, n FROM (
				SELECT outlet_id, reason, count(*)::int AS n,
					row_number() OVER (PARTITION BY outlet_id ORDER BY count(*) DESC) AS rn
				FROM (
					SELECT outlet_id, coalesce(content_reason, 'no reason recorded') AS reason FROM articles
					WHERE content_state = 'failed' AND discovered_at > now() - interval '7 days'
					UNION ALL
					SELECT outlet_id, 'classify: ' || left(coalesce(classify_error, 'no reason recorded'), 120) FROM articles
					WHERE content_state = 'extracted' AND classify_state = 'failed' AND discovered_at > now() - interval '7 days'
				) f
				GROUP BY outlet_id, reason
			) ranked
			WHERE rn <= 5
			ORDER BY outlet_id, n DESC`,
		sql<{ slug: string; state: 'unknown' | 'ok' | 'rejected'; state_at: Date | null; updated_at: Date }[]>`
			SELECT slug, state, state_at, updated_at FROM outlet_sessions`
	]);

	return outlets.map((o) => {
		const windows = { '24h': emptyWindow(), '7d': emptyWindow() };
		for (const c of counts.filter((c) => c.outlet_id === o.id)) {
			const w = windows[c.win];
			w.total += c.n;
			w.content[c.content_state as keyof WindowStats['content']] += c.n;
			if (c.content_state === 'extracted') w.classify[c.classify_state as keyof WindowStats['classify']] += c.n;
		}
		for (const w of Object.values(windows)) w.paywalledShare = w.total > 0 ? w.content.paywalled / w.total : null;
		const s = sessions.find((s) => s.slug === o.slug);
		return {
			...o,
			windows,
			failedReasons: reasons.filter((r) => r.outlet_id === o.id).map(({ reason, n }) => ({ reason, n })),
			session: s ? { state: s.state, stateAt: s.state_at, updatedAt: s.updated_at } : null
		};
	});
}

export async function setOutletEnabled(sql: Sql, outletId: number, enabled: boolean): Promise<void> {
	await sql`UPDATE outlets SET enabled = ${enabled} WHERE id = ${outletId}`;
}

export async function setOutletPriority(sql: Sql, outletId: number, priority: number): Promise<void> {
	await sql`UPDATE outlets SET priority = ${priority} WHERE id = ${outletId}`;
}

/** The worker discovers outlets whose last discovery is NULL first. */
export async function discoverNow(sql: Sql, outletId: number): Promise<void> {
	await sql`UPDATE outlets SET last_discovery_at = NULL WHERE id = ${outletId}`;
}

/** Re-queues the outlet's failed extractions (purged articles excepted). Returns the count. */
export async function reextractFailed(sql: Sql, outletId: number): Promise<number> {
	const rows = await sql`
		UPDATE articles SET content_state = 'pending', content_attempts = 0, content_next_at = now()
		WHERE outlet_id = ${outletId} AND content_state = 'failed' AND body_purged_at IS NULL
		RETURNING id`;
	return rows.length;
}

export const REFETCH_PAYWALLED_DAYS = 3;

/** Re-queues recent paywalled articles, e.g. after renewing a subscriber session. Returns the count. */
export async function refetchPaywalled(sql: Sql, outletId: number): Promise<number> {
	const rows = await sql`
		UPDATE articles SET content_state = 'pending', content_attempts = 0, content_next_at = now()
		WHERE outlet_id = ${outletId} AND content_state = 'paywalled' AND body_purged_at IS NULL
			AND published_at > now() - make_interval(days => ${REFETCH_PAYWALLED_DAYS})
		RETURNING id`;
	return rows.length;
}

export const RECLASSIFY_DAYS = 7;

/**
 * Re-queues classification of the outlet's extracted articles from the last RECLASSIFY_DAYS days
 * (bounded: every article is an LLM call). They stay hidden until classified again.
 */
export async function reclassifyOutlet(sql: Sql, outletId: number): Promise<number> {
	const rows = await sql`
		UPDATE articles SET classify_state = 'pending', classify_attempts = 0, classify_next_at = now()
		WHERE outlet_id = ${outletId} AND content_state = 'extracted' AND body_purged_at IS NULL
			AND discovered_at > now() - make_interval(days => ${RECLASSIFY_DAYS})
		RETURNING id`;
	return rows.length;
}

// ---------------------------------------------------------------------------------------------
// Pipeline

export interface ModelStats {
	model: string;
	calls: number;
	errors: number;
	p50_ms: number | null;
	p90_ms: number | null;
	input_tokens: number;
	output_tokens: number;
	cache_read_tokens: number;
}

export async function pipelineStats(sql: Sql) {
	const [[queues], models, llmErrors, articleErrors, discoveryErrors, editions, lastCall] = await Promise.all([
		sql<{ pending_content: number; due_content: number; pending_classify: number; due_classify: number; failed_content: number; failed_classify: number }[]>`
			SELECT
				count(*) FILTER (WHERE content_state = 'pending')::int AS pending_content,
				count(*) FILTER (WHERE content_state = 'pending' AND content_next_at <= now())::int AS due_content,
				count(*) FILTER (WHERE content_state = 'extracted' AND classify_state = 'pending' AND body_purged_at IS NULL)::int AS pending_classify,
				count(*) FILTER (WHERE content_state = 'extracted' AND classify_state = 'pending' AND body_purged_at IS NULL AND classify_next_at <= now())::int AS due_classify,
				count(*) FILTER (WHERE content_state = 'failed')::int AS failed_content,
				count(*) FILTER (WHERE content_state = 'extracted' AND classify_state = 'failed')::int AS failed_classify
			FROM articles`,
		sql<ModelStats[]>`
			SELECT model, count(*)::int AS calls, count(*) FILTER (WHERE NOT ok)::int AS errors,
				round(percentile_cont(0.5) WITHIN GROUP (ORDER BY latency_ms))::int AS p50_ms,
				round(percentile_cont(0.9) WITHIN GROUP (ORDER BY latency_ms))::int AS p90_ms,
				coalesce(sum(input_tokens), 0)::bigint AS input_tokens,
				coalesce(sum(output_tokens), 0)::bigint AS output_tokens,
				coalesce(sum(cache_read_tokens), 0)::bigint AS cache_read_tokens
			FROM llm_calls WHERE created_at > now() - interval '24 hours'
			GROUP BY model ORDER BY calls DESC`,
		sql<{ created_at: Date; model: string; article_id: number | null; error: string | null }[]>`
			SELECT created_at, model, article_id, left(error, 300) AS error FROM llm_calls
			WHERE NOT ok ORDER BY created_at DESC LIMIT 10`,
		sql<{ id: number; outlet: string; at: Date; stage: string; reason: string | null }[]>`
			SELECT a.id, o.name AS outlet, coalesce(a.classified_at, a.extracted_at, a.discovered_at) AS at,
				CASE WHEN a.content_state = 'failed' THEN 'extraction' ELSE 'classification' END AS stage,
				left(CASE WHEN a.content_state = 'failed' THEN a.content_reason ELSE a.classify_error END, 300) AS reason
			FROM articles a JOIN outlets o ON o.id = a.outlet_id
			WHERE a.content_state = 'failed' OR (a.content_state = 'extracted' AND a.classify_state = 'failed')
			ORDER BY a.discovered_at DESC LIMIT 15`,
		sql<{ name: string; last_discovery_at: Date | null; last_discovery_error: string }[]>`
			SELECT name, last_discovery_at, left(last_discovery_error, 300) AS last_discovery_error FROM outlets
			WHERE last_discovery_error IS NOT NULL ORDER BY name`,
		sql<{ id: number; cutoff: Date; label: string }[]>`SELECT id, cutoff, label FROM editions ORDER BY cutoff DESC LIMIT 12`,
		sql<{ model: string; created_at: Date }[]>`SELECT model, created_at FROM llm_calls ORDER BY created_at DESC LIMIT 1`
	]);
	return {
		queues,
		models,
		llmErrors,
		articleErrors,
		discoveryErrors,
		editions,
		configuredModel: process.env.LLM_MODEL ?? null,
		lastCall: lastCall[0] ?? null
	};
}

// ---------------------------------------------------------------------------------------------
// Reports

export interface ReportRow {
	id: number;
	article_id: number;
	title: string;
	calm_title: string | null;
	outlet: string;
	reporter: string | null;
	note: string | null;
	created_at: Date;
	resolved_at: Date | null;
	resolver: string | null;
}

export async function reports(sql: Sql, open: boolean, limit = 100): Promise<ReportRow[]> {
	return sql<ReportRow[]>`
		SELECT r.id, r.article_id, a.title, a.calm_title, o.name AS outlet, u.display_name AS reporter, r.note,
			r.created_at, r.resolved_at, ru.display_name AS resolver
		FROM reports r
		JOIN articles a ON a.id = r.article_id
		JOIN outlets o ON o.id = a.outlet_id
		LEFT JOIN users u ON u.id = r.user_id
		LEFT JOIN users ru ON ru.id = r.resolved_by
		WHERE ${open ? sql`r.resolved_at IS NULL` : sql`r.resolved_at IS NOT NULL`}
		ORDER BY ${open ? sql`r.created_at` : sql`r.resolved_at DESC`}
		LIMIT ${limit}`;
}

export async function resolveReport(sql: Sql, reportId: number, adminId: number): Promise<void> {
	await sql`UPDATE reports SET resolved_at = now(), resolved_by = ${adminId} WHERE id = ${reportId} AND resolved_at IS NULL`;
}

// ---------------------------------------------------------------------------------------------
// Article review

export interface TagRow {
	tag: string;
	ai: { intensity: number; confidence: number | null; basis: string | null } | null;
	/** Manual override; 0 = removed by an admin. */
	manual: number | null;
	effective: number;
}

export async function articleForAdmin(sql: Sql, articleId: number) {
	const [article] = await sql<
		{
			id: number;
			url: string;
			title: string;
			calm_title: string | null;
			summary: string | null;
			teaser: string | null;
			author: string | null;
			language: string | null;
			published_at: Date;
			discovered_at: Date;
			content_state: string;
			content_reason: string | null;
			classify_state: string;
			classify_error: string | null;
			classified_at: Date | null;
			model: string | null;
			prompt_version: string | null;
			importance: number | null;
			kind: string | null;
			section: string | null;
			body: Block[] | null;
			body_chars: number | null;
			body_purged_at: Date | null;
			source_meta: Record<string, unknown>;
			outlet: string;
		}[]
	>`
		SELECT a.id, a.url, a.title, a.calm_title, a.summary, a.teaser, a.author, a.language, a.published_at, a.discovered_at,
			a.content_state, a.content_reason, a.classify_state, a.classify_error, a.classified_at, a.model, a.prompt_version,
			a.importance, a.kind, a.section, a.body, a.body_chars, a.body_purged_at, a.source_meta, o.name AS outlet
		FROM articles a JOIN outlets o ON o.id = a.outlet_id
		WHERE a.id = ${articleId}`;
	if (!article) return null;

	const [tagRows, topics, images, imageTags, corrections, openReports] = await Promise.all([
		sql<{ tag: string; origin: 'ai' | 'manual'; intensity: number; confidence: number | null; basis: string | null }[]>`
			SELECT tag, origin, intensity, confidence, basis FROM article_tags WHERE article_id = ${articleId}`,
		sql<{ topic: string; rank: number; confidence: number | null }[]>`
			SELECT topic, rank, confidence FROM article_topics WHERE article_id = ${articleId} ORDER BY rank`,
		sql<{ id: number; position: number; caption: string | null; credit: string | null; alt: string | null; state: string; path: string | null; width: number | null; height: number | null; assessed: boolean }[]>`
			SELECT id, position, caption, credit, alt, state, path, width, height, assessed FROM images WHERE article_id = ${articleId} ORDER BY position`,
		sql<{ image_id: number; tag: string; intensity: number }[]>`
			SELECT t.image_id, t.tag, t.intensity FROM image_tags t JOIN images i ON i.id = t.image_id WHERE i.article_id = ${articleId}`,
		sql<{ id: number; tag: string; ai_intensity: number; new_intensity: number; admin: string | null; report_id: number | null; created_at: Date }[]>`
			SELECT c.id, c.tag, c.ai_intensity, c.new_intensity, u.display_name AS admin, c.report_id, c.created_at
			FROM tag_corrections c LEFT JOIN users u ON u.id = c.admin_id
			WHERE c.article_id = ${articleId} ORDER BY c.created_at DESC`,
		sql<{ id: number; reporter: string | null; note: string | null; created_at: Date }[]>`
			SELECT r.id, u.display_name AS reporter, r.note, r.created_at FROM reports r LEFT JOIN users u ON u.id = r.user_id
			WHERE r.article_id = ${articleId} AND r.resolved_at IS NULL ORDER BY r.created_at`
	]);

	const tags = new Map<string, TagRow>();
	for (const row of tagRows) {
		const entry = tags.get(row.tag) ?? { tag: row.tag, ai: null, manual: null, effective: 0 };
		if (row.origin === 'ai') entry.ai = { intensity: row.intensity, confidence: row.confidence, basis: row.basis };
		else entry.manual = row.intensity;
		tags.set(row.tag, entry);
	}
	for (const entry of tags.values()) entry.effective = entry.manual ?? entry.ai?.intensity ?? 0;

	return {
		article,
		tags: [...tags.values()].sort((x, y) => y.effective - x.effective || x.tag.localeCompare(y.tag)),
		topics,
		images: images.map((img) => ({ ...img, tags: imageTags.filter((t) => t.image_id === img.id).map(({ tag, intensity }) => ({ tag, intensity })) })),
		corrections,
		openReports
	};
}

/**
 * Admin tag correction: a manual row overrides the AI rows for that tag (0 = removed) and every
 * change is recorded in tag_corrections. Takes effect for readers on their next request.
 */
export async function correctTag(
	sql: Sql,
	c: { articleId: number; tag: string; intensity: number; adminId: number; reportId: number | null }
): Promise<void> {
	if (!TAG_KEYS.includes(c.tag)) error(400, 'Unknown tag');
	if (!Number.isInteger(c.intensity) || c.intensity < 0 || c.intensity > 3) error(400, 'Intensity must be 0 to 3');
	await sql.begin(async (tx) => {
		const [article] = await tx`SELECT id FROM articles WHERE id = ${c.articleId} FOR UPDATE`;
		if (!article) error(404, 'Not found');
		const [ai] = await tx<{ intensity: number }[]>`
			SELECT intensity FROM article_tags WHERE article_id = ${c.articleId} AND tag = ${c.tag} AND origin = 'ai'`;
		await tx`
			INSERT INTO article_tags (article_id, tag, origin, intensity) VALUES (${c.articleId}, ${c.tag}, 'manual', ${c.intensity})
			ON CONFLICT (article_id, tag, origin) DO UPDATE SET intensity = EXCLUDED.intensity`;
		const reportId = c.reportId
			? ((await tx`SELECT id FROM reports WHERE id = ${c.reportId} AND article_id = ${c.articleId}`)[0]?.id ?? null)
			: null;
		await tx`
			INSERT INTO tag_corrections (article_id, tag, ai_intensity, new_intensity, admin_id, report_id)
			VALUES (${c.articleId}, ${c.tag}, ${ai?.intensity ?? 0}, ${c.intensity}, ${c.adminId}, ${reportId})`;
	});
}

/** False when the article's body was purged (purged articles are never re-classified). */
export async function reclassifyArticle(sql: Sql, articleId: number): Promise<boolean> {
	const rows = await sql`
		UPDATE articles SET classify_state = 'pending', classify_attempts = 0, classify_next_at = now()
		WHERE id = ${articleId} AND content_state = 'extracted' AND body_purged_at IS NULL
		RETURNING id`;
	return rows.length > 0;
}

/**
 * Removes the stored text and photo files (rights-holder or erasure request). The article row,
 * summary, tags, topics and image rows (with their tags) stay, so filtering keeps working.
 */
export async function purgeArticle(sql: Sql, articleId: number): Promise<void> {
	await sql.begin(async (tx) => {
		const rows = await tx`
			UPDATE articles SET body = NULL, body_purged_at = coalesce(body_purged_at, now())
			WHERE id = ${articleId} RETURNING id`;
		if (rows.length === 0) error(404, 'Not found');
		await tx`UPDATE images SET path = NULL WHERE article_id = ${articleId}`;
	});
	await deleteArticleImages(articleId);
}

export async function adminImagePath(sql: Sql, imageId: number): Promise<string | null> {
	const [row] = await sql<{ path: string | null }[]>`SELECT path FROM images WHERE id = ${imageId} AND state = 'stored'`;
	return row?.path ?? null;
}

// ---------------------------------------------------------------------------------------------
// Users and invites

export interface UserRow {
	id: number;
	username: string;
	display_name: string;
	role: 'reader' | 'admin';
	created_at: Date;
	invited_by: string | null;
	last_sign_in: Date | null;
}

export async function users(sql: Sql): Promise<UserRow[]> {
	return sql<UserRow[]>`
		SELECT u.id, u.username, u.display_name, u.role, u.created_at, i.display_name AS invited_by,
			(SELECT max(created_at) FROM sessions s WHERE s.user_id = u.id) AS last_sign_in
		FROM users u LEFT JOIN users i ON i.id = u.invited_by
		ORDER BY u.created_at`;
}

export class AdminError extends Error {}

/** Sets a generated temporary password, ends the user's sessions and returns the password (shown once). */
export async function resetPassword(sql: Sql, userId: number): Promise<string> {
	const temporary = randomBytes(9).toString('base64url');
	const hash = await hashPassword(temporary);
	await sql.begin(async (tx) => {
		const rows = await tx`UPDATE users SET password_hash = ${hash} WHERE id = ${userId} RETURNING id`;
		if (rows.length === 0) throw new AdminError('No such user.');
		await tx`DELETE FROM sessions WHERE user_id = ${userId}`;
	});
	return temporary;
}

/** Locks the admin rows so two concurrent demotions or deletions cannot both pass the last-admin check. */
async function changeKeepingAnAdmin(sql: Sql, change: (tx: postgres.TransactionSql) => Promise<unknown>): Promise<void> {
	await sql.begin(async (tx) => {
		await tx`SELECT id FROM users WHERE role = 'admin' FOR UPDATE`;
		await change(tx);
		const [{ admins }] = await tx<{ admins: number }[]>`SELECT count(*)::int AS admins FROM users WHERE role = 'admin'`;
		if (admins === 0) throw new AdminError('At least one admin must remain.');
	});
}

export async function setRole(sql: Sql, userId: number, role: 'reader' | 'admin'): Promise<void> {
	await changeKeepingAnAdmin(sql, (tx) => tx`UPDATE users SET role = ${role} WHERE id = ${userId}`);
}

export async function deleteUser(sql: Sql, userId: number, actingAdminId: number): Promise<void> {
	if (userId === actingAdminId) throw new AdminError('You cannot delete your own account here.');
	await changeKeepingAnAdmin(sql, (tx) => tx`DELETE FROM users WHERE id = ${userId}`);
}

export interface InviteRow {
	code_hash: string;
	role: 'reader' | 'admin';
	note: string | null;
	created_at: Date;
	expires_at: Date;
	created_by: string | null;
}

export async function openInvites(sql: Sql): Promise<InviteRow[]> {
	return sql<InviteRow[]>`
		SELECT i.code_hash, i.role, i.note, i.created_at, i.expires_at, u.display_name AS created_by
		FROM invites i LEFT JOIN users u ON u.id = i.created_by
		WHERE i.used_at IS NULL AND i.expires_at > now()
		ORDER BY i.created_at DESC`;
}

export async function revokeInvite(sql: Sql, codeHash: string): Promise<void> {
	await sql`DELETE FROM invites WHERE code_hash = ${codeHash} AND used_at IS NULL`;
}
