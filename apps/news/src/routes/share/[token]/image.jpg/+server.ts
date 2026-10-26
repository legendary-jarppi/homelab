import { error } from '@sveltejs/kit';
import sharp from 'sharp';
import { db } from '$lib/core/db';
import { imagePath } from '$lib/core/images';
import { parseShareToken, sharePreview } from '$lib/server/share';
import type { RequestHandler } from './$types';

/** A share link's preview photo as JPEG (chat apps do not all take WebP), 1080 px wide at most. */
export const GET: RequestHandler = async ({ params }) => {
	const id = parseShareToken(params.token);
	const preview = id === null ? null : await sharePreview(db(), id);
	if (!preview?.photoPath) error(404, 'Not found');
	let jpeg: Buffer;
	try {
		jpeg = await sharp(imagePath(preview.photoPath)).resize({ width: 1080, withoutEnlargement: true }).jpeg({ quality: 78, mozjpeg: true }).toBuffer();
	} catch {
		error(404, 'Not found');
	}
	return new Response(new Uint8Array(jpeg), {
		// private: Cloudflare's edge caches .jpg by default; a purged article's photo must go with it.
		headers: { 'content-type': 'image/jpeg', 'content-length': String(jpeg.length), 'cache-control': 'private, max-age=3600' }
	});
};
