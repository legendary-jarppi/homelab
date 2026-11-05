import { error, json } from '@sveltejs/kit';
import { CalendarInputError, removeEvent, updateEvent } from '$lib/server/calendar';
import { GoogleCalendarError } from '$lib/server/google-calendar';
import type { CalendarEventChange } from '$lib/types';
import type { RequestHandler } from './$types';

/** Body: CalendarEventChange (only the changed parts). 200 with the event as the card shows it. */
export const PATCH: RequestHandler = async ({ params, request }) => {
	const body = (await request.json().catch(() => null)) as CalendarEventChange | null;
	if (!body || typeof body !== 'object') error(400, 'Expected the changes as JSON');
	try {
		return json(await updateEvent(params.id, body));
	} catch (e) {
		if (e instanceof CalendarInputError) error(400, e.message);
		if (e instanceof GoogleCalendarError && (e.status === 404 || e.status === 410)) error(404, 'The event is no longer in the calendar.');
		console.error(`calendar edit: ${(e as Error).message}`);
		error(502, 'Google Calendar did not accept the change');
	}
};

/** 204; an event already gone (deleted elsewhere meanwhile) also answers 204. */
export const DELETE: RequestHandler = async ({ params }) => {
	try {
		await removeEvent(params.id);
		return new Response(null, { status: 204 });
	} catch (e) {
		if (e instanceof CalendarInputError) error(400, e.message);
		console.error(`calendar delete: ${(e as Error).message}`);
		error(502, 'Google Calendar did not delete the event');
	}
};
