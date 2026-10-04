// Photo display decisions for one reader. 'show': a photo is shown when it was assessed and none of
// its tags reach the reader's threshold; otherwise it waits behind a neutral "Show photo" button.
// 'click': every photo waits. 'hide': no photos. Only photos of visible articles are returned.
import type postgres from 'postgres';
import { visibleTo } from '$lib/core/visibility';
import type { ReaderContext } from './articles';

export interface Photo {
	id: number;
	width: number;
	height: number;
	caption: string | null;
	credit: string | null;
	alt: string | null;
	/** Behind "Show photo"; bytes are requested only after the reader taps. */
	gated: boolean;
}

interface PhotoRow {
	id: number;
	position: number;
	width: number;
	height: number;
	caption: string | null;
	credit: string | null;
	alt: string | null;
	assessed: boolean;
	tags: { tag: string; intensity: number }[];
}

function toPhoto(ctx: ReaderContext, r: PhotoRow): Photo {
	const hit = r.tags.some((t) => {
		const threshold = ctx.thresholds.get(t.tag);
		return threshold !== undefined && t.intensity >= threshold;
	});
	const gated = ctx.settings.images === 'click' || !r.assessed || hit;
	return { id: r.id, width: r.width, height: r.height, caption: r.caption, credit: r.credit, alt: r.alt, gated };
}

function photoRows(ctx: ReaderContext, where: postgres.PendingQuery<postgres.Row[]>) {
	const { sql, reader } = ctx;
	return sql<PhotoRow[]>`
		SELECT i.id, i.position, i.width, i.height, i.caption, i.credit, i.alt, i.assessed,
			coalesce(
				(SELECT json_agg(json_build_object('tag', it.tag, 'intensity', it.intensity)) FROM image_tags it WHERE it.image_id = i.id),
				'[]'::json) AS tags
		FROM images i JOIN articles a ON a.id = i.article_id
		WHERE ${where}
			AND i.state = 'stored' AND i.path IS NOT NULL AND i.width > 0 AND i.height > 0
			AND ${visibleTo(sql, reader)}
		ORDER BY i.position`;
}

/** Lead photos for a list of cards, in one query. */
export async function photosByIds(ctx: ReaderContext, ids: number[]): Promise<Map<number, Photo>> {
	if (ids.length === 0 || ctx.settings.images === 'hide') return new Map();
	const rows = await photoRows(ctx, ctx.sql`i.id = ANY(${ids}::bigint[])`);
	return new Map(rows.map((r) => [r.id, toPhoto(ctx, r)]));
}

/** All displayable photos of a (visible) article, by position. */
export async function articlePhotos(ctx: ReaderContext, articleId: number): Promise<Record<number, Photo>> {
	if (ctx.settings.images === 'hide') return {};
	const rows = await photoRows(ctx, ctx.sql`i.article_id = ${articleId}`);
	return Object.fromEntries(rows.map((r) => [r.position, toPhoto(ctx, r)]));
}
