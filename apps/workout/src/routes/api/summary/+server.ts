// This week per person, for the home dashboard's workout card (server-to-server, bearer token).
// Contract: WorkoutSummary in apps/dashboard/src/lib/types.ts.
import { createHash, timingSafeEqual } from 'node:crypto';
import { error, json } from '@sveltejs/kit';
import { MACHINES, PEOPLE, addDays, splitTotal, today } from '$lib/domain';
import { config } from '$lib/server/config';
import { db } from '$lib/server/db';
import { weeksCovering } from '$lib/server/workouts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ request }) => {
	if (!config.summaryToken) error(404, 'Not found');
	// Hash both sides so the comparison is constant-time regardless of length.
	const given = createHash('sha256').update(request.headers.get('authorization') ?? '').digest();
	const expected = createHash('sha256').update(`Bearer ${config.summaryToken}`).digest();
	if (!timingSafeEqual(given, expected)) error(401, 'Unauthorized');

	const now = today(config.timeZone);
	const [week] = await weeksCovering(db(), now, now);
	return json(
		{
			week: { year: week.year, week: week.week, start: week.start, end: addDays(week.start, 6) },
			people: PEOPLE.map((p) => ({
				id: p.id,
				name: p.name,
				meters: splitTotal(week.bucket[p.id].split),
				workouts: week.bucket[p.id].count,
				byMachine: MACHINES.map((m) => ({ id: m.id, name: m.name, short: m.short, meters: week.bucket[p.id].split[m.id] }))
			}))
		},
		{ headers: { 'cache-control': 'no-store' } }
	);
};
