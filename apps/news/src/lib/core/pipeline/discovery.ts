// Discovery: runs each enabled outlet's discover() when its interval has passed and queues new
// URLs as pending articles. One outlet failing never affects the others.
import type { Sql } from '../db.ts';
import { outletBySlug } from '../outlets/index.ts';
import type { Discovered, OutletDef } from '../outlets/types.ts';
import { errorText, log } from './log.ts';

/** Older items are ignored: feeds and sitemaps reach back days, the paper covers the last few. */
const MAX_AGE_MS = Number(process.env.DISCOVERY_MAX_AGE_H ?? 72) * 3600_000;

interface OutletRow {
	id: number;
	slug: string;
	requires_auth: boolean;
	last_discovery_at: Date | null;
}

/** Enabled outlets whose discovery is due (never run, re-run requested via NULL, or interval passed). */
async function dueOutlets(sql: Sql, now: Date): Promise<{ row: OutletRow; def: OutletDef }[]> {
	const rows = await sql<OutletRow[]>`SELECT id, slug, requires_auth, last_discovery_at FROM outlets WHERE enabled ORDER BY priority DESC, id`;
	const due: { row: OutletRow; def: OutletDef }[] = [];
	for (const row of rows) {
		const def = outletBySlug(row.slug);
		if (!def) continue;
		if (!row.last_discovery_at || now.getTime() - row.last_discovery_at.getTime() >= def.discoveryIntervalMin * 60_000) due.push({ row, def });
	}
	return due;
}

/** Inserts discovered items; returns how many URLs were new. */
export async function insertDiscovered(sql: Sql, outlet: OutletRow, items: Discovered[], now = new Date()): Promise<number> {
	const fresh = items.filter((i) => !i.publishedAt || now.getTime() - i.publishedAt.getTime() <= MAX_AGE_MS);
	if (fresh.length === 0) return 0;
	const unique = [...new Map(fresh.map((i) => [i.url, i])).values()];
	const state = outlet.requires_auth ? 'paywalled' : 'pending';
	const reason = outlet.requires_auth ? 'outlet requires credentials' : null;
	const rows = unique.map((i) => ({
		outlet_id: outlet.id,
		url: i.url,
		title: i.title.trim() || i.url,
		teaser: i.teaser?.trim() || null,
		// A future date would sort the article above everything else; clamp to now.
		published_at: i.publishedAt && i.publishedAt <= now ? i.publishedAt : now,
		content_state: state,
		content_reason: reason
	}));
	const inserted = await sql`
		INSERT INTO articles ${sql(rows, 'outlet_id', 'url', 'title', 'teaser', 'published_at', 'content_state', 'content_reason')}
		ON CONFLICT (url) DO NOTHING RETURNING id`;
	return inserted.length;
}

async function discoverOutlet(sql: Sql, row: OutletRow, def: OutletDef): Promise<void> {
	const started = Date.now();
	try {
		const items = await def.discover();
		const added = await insertDiscovered(sql, row, items);
		await sql`
			UPDATE outlets SET last_discovery_at = now(), last_discovery_error = NULL,
				last_discovery_found = ${items.length}, last_discovery_new = ${added}
			WHERE id = ${row.id}`;
		log.info('discovery', { outlet: row.slug, found: items.length, new: added, ms: Date.now() - started });
	} catch (e) {
		await sql`
			UPDATE outlets SET last_discovery_at = now(), last_discovery_error = ${errorText(e)},
				last_discovery_found = NULL, last_discovery_new = NULL
			WHERE id = ${row.id}`;
		log.warn('discovery-failed', { outlet: row.slug, ms: Date.now() - started, error: errorText(e) });
	}
}

/** One discovery pass over all due outlets, in parallel (they are different hosts). */
export async function discoverDue(sql: Sql): Promise<number> {
	const due = await dueOutlets(sql, new Date());
	await Promise.all(due.map(({ row, def }) => discoverOutlet(sql, row, def)));
	return due.length;
}
