// Family calendar from a Google Calendar "secret address in iCal format" (CALENDAR_ICS_URL).
// Recurring events are expanded (with their exceptions and cancellations) over the days the
// card shows: today through the end of next week.
import ICAL from 'ical.js';
import { config } from '$lib/server/config';
import type { CalendarData, CalendarEvent } from '$lib/types';

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
		events.push({
			id: `${item.uid}/${recurrence}`,
			title: (item.summary ?? '').trim() || '(no title)',
			start: allDay ? dateKey(start) : start.toJSDate().toISOString(),
			end: allDay ? dateKey(endValue) : endValue.toJSDate().toISOString(),
			allDay,
			location: location || null,
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
	return { timeZone: TIME_ZONE, events, updatedAt: Date.now() };
}

let cache: { at: number; data: CalendarData } | null = null;

export async function familyCalendar(now = new Date()): Promise<CalendarData> {
	if (cache && now.getTime() - cache.at < CACHE_MS) return cache.data;
	try {
		const response = await fetch(config.calendarIcsUrl, { signal: AbortSignal.timeout(10_000) });
		if (!response.ok) throw new Error(`HTTP ${response.status}`);
		const data = parseCalendar(
			await response.text(),
			new Date(now.getTime() - WINDOW_BEFORE_MS),
			new Date(now.getTime() + WINDOW_AFTER_MS),
			config.calendarColor
		);
		cache = { at: now.getTime(), data };
		return data;
	} catch (e) {
		// Never log the URL: it is the calendar's secret address.
		console.error(`calendar feed: ${(e as Error).message}`);
		if (cache && now.getTime() - cache.at < STALE_MS) return cache.data;
		throw e;
	}
}
