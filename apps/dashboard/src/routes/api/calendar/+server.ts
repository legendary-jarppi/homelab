import { error, json } from '@sveltejs/kit';
import { addEvent, CalendarInputError, calendarConfigured, familyCalendar } from '$lib/server/calendar';
import type { NewCalendarEvent } from '$lib/types';
import type { RequestHandler } from './$types';

/** Family calendar for the card: today through the end of next week. */
export const GET: RequestHandler = async () => {
	if (!calendarConfigured()) error(404, 'Calendar not configured');
	try {
		return json(await familyCalendar(), { headers: { 'Cache-Control': 'no-store' } });
	} catch {
		error(502, 'Calendar unavailable');
	}
};

/** Body: NewCalendarEvent. 201 with the event as the card shows it. */
export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json().catch(() => null)) as NewCalendarEvent | null;
	if (!body || typeof body !== 'object') error(400, 'Expected the event as JSON');
	try {
		return json(await addEvent(body), { status: 201 });
	} catch (e) {
		if (e instanceof CalendarInputError) error(400, e.message);
		console.error(`calendar add: ${(e as Error).message}`);
		error(502, 'Google Calendar did not accept the event');
	}
};
