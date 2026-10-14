// Lists marked "Show on dashboard", each with its first items in the list's own order, for the home
// dashboard's list cards (server-to-server, bearer token). Contract: ListsData in
// apps/dashboard/src/lib/types.ts.
import { createHash, timingSafeEqual } from 'node:crypto';
import { error, json } from '@sveltejs/kit';
import { initials } from '$lib/domain';
import { config } from '$lib/server/config';
import { db } from '$lib/server/db';
import { items, lists, people } from '$lib/server/lists';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ request }) => {
	if (!config.dashboardToken) error(404, 'Not found');
	// Hash both sides so the comparison is constant-time regardless of length.
	const given = createHash('sha256').update(request.headers.get('authorization') ?? '').digest();
	const expected = createHash('sha256').update(`Bearer ${config.dashboardToken}`).digest();
	if (!timingSafeEqual(given, expected)) error(401, 'Unauthorized');

	const sql = db();
	const [everyone, all] = await Promise.all([people(sql), lists(sql)]);
	const shown = all.filter((l) => l.dashboardCount > 0);
	const entries = await Promise.all(shown.map((l) => items(sql, l, { limit: l.dashboardCount })));
	return json(
		{
			people: everyone.map((p) => ({ id: p.id, name: p.name, short: initials(p.name) })),
			lists: shown.map((l, i) => ({
				slug: l.slug,
				name: l.name,
				dateLabel: l.useDate ? l.dateLabel : null,
				usesPeople: l.usePeople,
				usesService: l.useService,
				items: entries[i].map((it) => ({
					id: it.id,
					title: it.title,
					day: l.useDate ? it.day : null,
					people: l.usePeople ? it.people : [],
					service: l.useService ? it.service : null,
					link: l.useLink ? it.link : null
				}))
			}))
		},
		{ headers: { 'cache-control': 'no-store' } }
	);
};
