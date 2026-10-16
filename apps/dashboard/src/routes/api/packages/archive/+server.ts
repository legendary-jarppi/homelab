import { json } from '@sveltejs/kit';
import { listArchived } from '$lib/server/packages';
import type { RequestHandler } from './$types';

/** Archived packages, most recently archived first. */
export const GET: RequestHandler = async () => json(await listArchived(), { headers: { 'Cache-Control': 'no-store' } });
