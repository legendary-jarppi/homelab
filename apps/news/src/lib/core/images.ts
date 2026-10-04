// Article photos: downloaded once through the crawler client, stored as WebP renditions under
// IMAGE_DIR/<article>/<position>.webp, served by the web app (never hotlinked from outlets).
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import type { Sql } from './db.ts';
import { get } from './http.ts';

export const IMAGE_DIR = process.env.IMAGE_DIR ?? path.resolve('.cache/images');
const MAX_WIDTH = 1600;
const CLASSIFIER_WIDTH = 768;
/** Tiny images are icons, logos or tracking pixels, not editorial photos. */
const MIN_EDGE = 120;

export function imagePath(relative: string): string {
	return path.join(IMAGE_DIR, relative);
}

/** Downloads and stores all pending images of an article; failures are recorded per image. */
export async function storeArticleImages(sql: Sql, articleId: number): Promise<{ stored: number; failed: number }> {
	const pending = await sql<{ id: number; position: number; source_url: string }[]>`
		SELECT id, position, source_url FROM images WHERE article_id = ${articleId} AND state = 'pending' ORDER BY position`;
	let stored = 0;
	let failed = 0;
	for (const image of pending) {
		try {
			const response = await get(image.source_url, { accept: 'image/avif,image/webp,image/jpeg,image/png,image/*;q=0.8', maxBytes: 20 * 1024 * 1024 });
			const pipeline = sharp(response.body, { failOn: 'error', limitInputPixels: 80_000_000 }).rotate();
			const meta = await pipeline.metadata();
			if ((meta.width ?? 0) < MIN_EDGE || (meta.height ?? 0) < MIN_EDGE) throw new Error(`too small (${meta.width}x${meta.height})`);
			const { data, info } = await pipeline
				.resize({ width: MAX_WIDTH, withoutEnlargement: true })
				.webp({ quality: 80 })
				.toBuffer({ resolveWithObject: true });
			const relative = path.join(String(articleId), `${image.position}.webp`);
			await mkdir(path.dirname(imagePath(relative)), { recursive: true });
			await writeFile(imagePath(relative), data);
			await sql`UPDATE images SET state = 'stored', path = ${relative}, width = ${info.width}, height = ${info.height} WHERE id = ${image.id}`;
			stored++;
		} catch (e) {
			await sql`UPDATE images SET state = 'failed' WHERE id = ${image.id}`;
			console.warn(`image ${image.id} (${image.source_url}): ${(e as Error).message}`);
			failed++;
		}
	}
	return { stored, failed };
}

/** A JPEG rendition small enough for the classifier (~500 tokens per image). */
export async function classifierJpeg(relative: string): Promise<Buffer> {
	return sharp(await readFile(imagePath(relative)))
		.resize({ width: CLASSIFIER_WIDTH, height: CLASSIFIER_WIDTH, fit: 'inside', withoutEnlargement: true })
		.jpeg({ quality: 75 })
		.toBuffer();
}

export async function deleteArticleImages(articleId: number): Promise<void> {
	await rm(path.join(IMAGE_DIR, String(articleId)), { recursive: true, force: true });
}
