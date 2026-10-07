import { error } from '@sveltejs/kit';
import { today, weekStart } from '$lib/domain';
import { config } from '$lib/server/config';
import { db } from '$lib/server/db';
import { dayRows, weeksOfYear, yearTotals } from '$lib/server/workouts';
import { bucketize, selectedPeople } from '$lib/stats';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, url }) => {
	const now = today(config.timeZone);
	const year = Number(params.year);
	if (!/^\d{4}$/.test(params.year) || year < 2000 || year > Number(now.slice(0, 4))) error(404, 'Not found');

	const sql = db();
	const [rows, weeks, years] = await Promise.all([
		dayRows(sql, `${year}-01-01`, `${year}-12-31`),
		weeksOfYear(sql, year, now),
		yearTotals(sql)
	]);
	const monthKeys = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`);
	const months = bucketize(rows, monthKeys, (day) => day.slice(0, 7));
	return {
		year,
		people: selectedPeople(url.searchParams.get('p')),
		/** Calendar year. */
		total: bucketize(rows, [params.year], (day) => day.slice(0, 4))[params.year],
		months: monthKeys.map((key) => ({ key, bucket: months[key] })),
		/** ISO weeks of the ISO year, up to the current week. */
		weeks,
		years,
		currentWeekStart: weekStart(now)
	};
};
