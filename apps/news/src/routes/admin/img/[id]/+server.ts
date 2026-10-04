// Unfiltered photo bytes for the admin article review (admin-only by hooks.server.ts).
import { readFile } from 'node:fs/promises';
import { error } from '@sveltejs/kit';
import { db } from '$lib/core/db';
import { imagePath } from '$lib/core/images';
import { adminIdOf, adminImagePath } from '$lib/server/admin';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, locals }) => {
	adminIdOf(locals);
	const id = Number(params.id);
	const relative = Number.isSafeInteger(id) ? await adminImagePath(db(), id) : null;
	if (!relative) error(404, 'Not found');
	const bytes = await readFile(imagePath(relative)).catch(() => null);
	if (!bytes) error(404, 'Not found');
	return new Response(bytes, { headers: { 'Content-Type': 'image/webp', 'Cache-Control': 'private, no-store' } });
};
