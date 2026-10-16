// Family calendar: through the Google Calendar API when a service account is set up (then events
// can also be added), otherwise from the calendar's "secret address in iCal format"
// (CALENDAR_ICS_URL, read-only), whose recurring events are expanded here (with their exceptions and
// cancellations). Either way over the days the card shows: today through the end of next week.
import ICAL from 'ical.js';
import { config } from '$lib/server/config';
import { googleCalendarConfigured, insertEvent, listEvents, type GoogleEvent, type GoogleTime } from '$lib/server/google-calendar';
import type { CalendarData, CalendarEvent, NewCalendarEvent } from '$lib/types';

/** Day boundaries are the household's, whatever zone the calendar itself is set to. */
export const TIME_ZONE = 'Europe/Helsinki';
/** The feed is fetched at most this often; every open dashboard shares the result. */
const CACHE_MS = 5 * 60_000;
/** On a failed fetch, the last good result is served while it is younger than this. */
const STALE_MS = 60 * 60_000;
/** Covers the card's range (today through next Sunday) with a day of margin on both sides. */
const WINDOW_BEFORE_MS = 86_400_000;
const WINDOW_AFTER_MS = 16 * 86_400_000;
/** Guard against runaway rules (e.g. minutely recurrences). */
const MAX_OCCURRENCES_PER_EVENT = 500;

const dateKey = (t: ICAL.Time) => `${t.year}-${String(t.month).padStart(2, '0')}-${String(t.day).padStart(2, '0')}`;
const sortKey = (e: CalendarEvent) => (e.allDay ? `${e.start}T00:00:00.000Z!` : e.start);

/** Parses an iCalendar feed into the occurrences that overlap [from, to). */
export function parseCalendar(ics: string, from: Date, to: Date, color: string): CalendarData {
	const root = new ICAL.Component(ICAL.parse(ics));
	for (const vtz of root.getAllSubcomponents('vtimezone')) ICAL.TimezoneService.register(new ICAL.Timezone(vtz));
	const calendar = (root.getFirstPropertyValue('x-wr-calname') as string | null) || 'Calendar';

	const masters = new Map<string, ICAL.Event>();
	const exceptions: ICAL.Event[] = [];
	for (const vevent of root.getAllSubcomponents('vevent')) {
		const event = new ICAL.Event(vevent);
		if (event.isRecurrenceException()) exceptions.push(event);
		else masters.set(event.uid, event);
	}
	const orphans: ICAL.Event[] = [];
	for (const ex of exceptions) {
		const master = masters.get(ex.uid);
		if (master) master.relateException(ex);
		else orphans.push(ex);
	}

	const windowStart = ICAL.Time.fromJSDate(from, true);
	const windowEnd = ICAL.Time.fromJSDate(to, true);
	const events: CalendarEvent[] = [];

	const add = (item: ICAL.Event, start: ICAL.Time, end: ICAL.Time, recurrence: string) => {
		if (item.component.getFirstPropertyValue('status') === 'CANCELLED') return;
		if (end.compare(windowStart) <= 0 || start.compare(windowEnd) >= 0) return;
		const allDay = start.isDate;
		let endValue = end;
		if (allDay && end.compare(start) <= 0) {
			endValue = start.clone();
			endValue.adjust(1, 0, 0, 0);
		}
		const location = (item.location ?? '').trim();
		const description = (item.description ?? '').trim();
		events.push({
			id: `${item.uid}/${recurrence}`,
			title: (item.summary ?? '').trim() || '(no title)',
			start: allDay ? dateKey(start) : start.toJSDate().toISOString(),
			end: allDay ? dateKey(endValue) : endValue.toJSDate().toISOString(),
			allDay,
			location: location || null,
			description: description || null,
			calendar,
			color
		});
	};

	for (const event of masters.values()) {
		if (!event.isRecurring()) {
			add(event, event.startDate, event.endDate, event.startDate.toString());
			continue;
		}
		const iterator = event.iterator();
		for (let i = 0, next = iterator.next(); next && i < MAX_OCCURRENCES_PER_EVENT; i++, next = iterator.next()) {
			if (next.compare(windowEnd) >= 0) break;
			const occurrence = event.getOccurrenceDetails(next);
			add(occurrence.item, occurrence.startDate, occurrence.endDate, next.toString());
		}
	}
	for (const ex of orphans) add(ex, ex.startDate, ex.endDate, ex.recurrenceId.toString());

	events.sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
	return { timeZone: TIME_ZONE, events, updatedAt: Date.now(), writable: false };
}

/** Google's event descriptions are HTML (line breaks, links, bold): reduced to plain lines. */
export function plainText(html: string): string {
	return html
		.replace(/<br\s*\/?>|<\/(p|div|li)>/gi, '\n')
		.replace(/<[^>]*>/g, '')
		.replace(/&nbsp;/g, ' ')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&amp;/g, '&')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
}

const isoOf = (t: GoogleTime) => t.date ?? new Date(t.dateTime ?? 0).toISOString();

export function fromGoogle(e: GoogleEvent, calendar: string, color: string): CalendarEvent | null {
	if (e.status === 'cancelled') return null;
	const description = plainText(e.description ?? '');
	return {
		id: e.id,
		title: (e.summary ?? '').trim() || '(no title)',
		start: isoOf(e.start),
		end: isoOf(e.end),
		allDay: e.start.date !== undefined,
		location: (e.location ?? '').trim() || null,
		description: description || null,
		calendar,
		color
	};
}

export const calendarConfigured = () => googleCalendarConfigured() || config.calendarIcsUrl !== '';

async function load(now: Date): Promise<CalendarData> {
	const from = new Date(now.getTime() - WINDOW_BEFORE_MS);
	const to = new Date(now.getTime() + WINDOW_AFTER_MS);
	if (googleCalendarConfigured()) {
		const { summary, items } = await listEvents(from, to);
		const events = items.flatMap((e) => fromGoogle(e, summary, config.calendarColor) ?? []);
		events.sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
		return { timeZone: TIME_ZONE, events, updatedAt: Date.now(), writable: true };
	}
	const response = await fetch(config.calendarIcsUrl, { signal: AbortSignal.timeout(10_000) });
	if (!response.ok) throw new Error(`HTTP ${response.status}`);
	return parseCalendar(await response.text(), from, to, config.calendarColor);
}

let cache: { at: number; data: CalendarData } | null = null;

export async function familyCalendar(now = new Date()): Promise<CalendarData> {
	if (cache && now.getTime() - cache.at < CACHE_MS) return cache.data;
	try {
		const data = await load(now);
		cache = { at: now.getTime(), data };
		return data;
	} catch (e) {
		// Never log the iCal URL: it is the calendar's secret address.
		console.error(`calendar: ${(e as Error).message}`);
		if (cache && now.getTime() - cache.at < STALE_MS) return cache.data;
		throw e;
	}
}

export class CalendarInputError extends Error {}

const pad = (n: number) => String(n).padStart(2, '0');
/** Wall-clock date and time plus minutes ("2026-10-16", "23:30", 90 -> "2026-10-17T01:00:00"). */
function wallPlus(date: string, time: string, minutes: number): string {
	const [y, m, d] = date.split('-').map(Number);
	const [h, min] = time.split(':').map(Number);
	const t = new Date(Date.UTC(y, m - 1, d, h, min + minutes));
	return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}T${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}:00`;
}

/** Adds an event to the family calendar (Google Calendar API only) and returns it as the card shows it. */
export async function addEvent(input: NewCalendarEvent): Promise<CalendarEvent> {
	if (!googleCalendarConfigured()) throw new CalendarInputError('Adding events is not set up.');
	const title = input.title?.trim().slice(0, 200);
	if (!title) throw new CalendarInputError('Give the event a name.');
	if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date ?? '') || Number.isNaN(Date.parse(input.date))) throw new CalendarInputError('Choose a date.');
	const text = (s: string | null, max: number) => s?.trim().slice(0, max) || undefined;
	const base = { summary: title, location: text(input.location, 200), description: text(input.description, 2000) };
	let event: Omit<GoogleEvent, 'id' | 'status'>;
	if (input.allDay) {
		const days = input.days ?? 1;
		if (!Number.isInteger(days) || days < 1 || days > 31) throw new CalendarInputError('An all-day event lasts 1 to 31 days.');
		event = { ...base, start: { date: input.date }, end: { date: wallPlus(input.date, '00:00', days * 1440).slice(0, 10) } };
	} else {
		if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(input.time ?? '')) throw new CalendarInputError('Choose a start time.');
		const minutes = input.minutes ?? 60;
		if (!Number.isInteger(minutes) || minutes < 5 || minutes > 7 * 1440) throw new CalendarInputError('Choose how long it lasts.');
		const time = input.time as string;
		event = {
			...base,
			start: { dateTime: `${input.date}T${time}:00`, timeZone: TIME_ZONE },
			end: { dateTime: wallPlus(input.date, time, minutes), timeZone: TIME_ZONE }
		};
	}
	const created = await insertEvent(event);
	cache = null;
	return fromGoogle(created, 'Calendar', config.calendarColor) as CalendarEvent;
}
