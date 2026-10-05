import { error, json } from '@sveltejs/kit';
import { familyCalendar } from '$lib/server/calendar';
import { config } from '$lib/server/config';
import type { RequestHandler } from './$types';

/** Family calendar for the card: today through the end of next week. */
export const GET: RequestHandler = async () => {
	if (!config.calendarIcsUrl) error(404, 'Calendar not configured');
	try {
		return json(await familyCalendar(), { headers: { 'Cache-Control': 'no-store' } });
	} catch {
		error(502, 'Calendar feed unavailable');
	}
};
