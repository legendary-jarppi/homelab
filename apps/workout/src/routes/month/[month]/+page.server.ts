import { error } from '@sveltejs/kit';
import { daysInMonth, today, weekStart } from '$lib/domain';
import { config } from '$lib/server/config';
import { db } from '$lib/server/db';
import { dayRows, firstDay, weeksCovering, workoutsBetween } from '$lib/server/workouts';
import { bucketize, selectedPeople } from '$lib/stats';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, url }) => {
	const now = today(config.timeZone);
	const key = params.month;
	const [year, month] = key.split('-').map(Number);
	if (!/^\d{4}-\d{2}$/.test(key) || year < 2000 || month < 1 || month > 12 || key > now.slice(0, 7)) error(404, 'Not found');

	const from = `${key}-01`;
	const to = `${key}-${String(daysInMonth(year, month)).padStart(2, '0')}`;
	const days = Array.from({ length: daysInMonth(year, month) }, (_, i) => `${key}-${String(i + 1).padStart(2, '0')}`);
	const sql = db();
	const [rows, weeks, workouts, first] = await Promise.all([
		dayRows(sql, from, to),
		weeksCovering(sql, from, to < now ? to : now),
		workoutsBetween(sql, from, to),
		firstDay(sql)
	]);
	const byDay = bucketize(rows, days, (day) => day);
	return {
		key,
		year,
		month,
		people: selectedPeople(url.searchParams.get('p')),
		total: bucketize(rows, [key], (day) => day.slice(0, 7))[key],
		days: days.map((day) => ({ day, bucket: byDay[day] })),
		/** Full weeks overlapping the month (up to this week). */
		weeks,
		workouts,
		firstMonth: (first ?? now).slice(0, 7),
		currentWeekStart: weekStart(now)
	};
};
