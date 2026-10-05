import { json } from '@sveltejs/kit';
import { sampleCalendar } from '$lib/server/calendar';
import type { RequestHandler } from './$types';

/** Family calendar for the card: today and the next days. */
export const GET: RequestHandler = () => json(sampleCalendar(), { headers: { 'Cache-Control': 'no-store' } });
