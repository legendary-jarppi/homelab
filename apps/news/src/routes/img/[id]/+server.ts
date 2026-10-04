import { error } from '@sveltejs/kit';
import { readFile } from 'node:fs/promises';
import { imagePath } from '$lib/core/images';
import { visibleTo } from '$lib/core/visibility';
import { parseId, readerContext } from '$lib/server/articles';
import type { RequestHandler } from './$types';

// Stored WebP of a photo whose article is visible to this reader; anything else is the same 404.
export const GET: RequestHandler = async ({ locals, params }) => {
	const id = parseId(params.id);
	const ctx = await readerContext(locals);
	if (ctx.settings.images === 'hide') error(404, 'Not found');
	const { sql, reader } = ctx;
	const [row] = await sql<{ path: string }[]>`
		SELECT i.path FROM images i JOIN articles a ON a.id = i.article_id
		WHERE i.id = ${id} AND i.state = 'stored' AND i.path IS NOT NULL AND ${visibleTo(sql, reader)}`;
	if (!row) error(404, 'Not found');
	let bytes: Buffer;
	try {
		bytes = await readFile(imagePath(row.path));
	} catch {
		error(404, 'Not found');
	}
	return new Response(new Uint8Array(bytes), {
		headers: {
			'content-type': 'image/webp',
			'content-length': String(bytes.length),
			'cache-control': 'private, max-age=31536000, immutable'
		}
	});
};
