// Family calendar data. Static sample events, laid out relative to today, while the card's design
// is iterated; replaced later by Google Calendar with the same CalendarData shape.
import type { CalendarData, CalendarEvent } from '$lib/types';

export const TIME_ZONE = 'Europe/Helsinki';

const CALENDARS = {
	family: { calendar: 'Family', color: '#38bdf8' },
	jari: { calendar: 'Jari', color: '#c084fc' },
	hobbies: { calendar: 'Hobbies', color: '#34d399' },
	school: { calendar: 'School', color: '#fbbf24' }
} as const;

/** "YYYY-MM-DD" of the day `offset` days from today in the calendar's zone. */
function dayKey(now: Date, offset: number): string {
	const today = new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE }).format(now);
	const d = new Date(`${today}T12:00:00Z`);
	d.setUTCDate(d.getUTCDate() + offset);
	return d.toISOString().slice(0, 10);
}

/** The instant of local wall time `hh:mm` on day `key` in the calendar's zone. */
function at(key: string, hh: number, mm = 0): string {
	const guess = Date.parse(`${key}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00Z`);
	const name = new Intl.DateTimeFormat('en-US', { timeZone: TIME_ZONE, timeZoneName: 'longOffset' })
		.formatToParts(guess)
		.find((p) => p.type === 'timeZoneName')?.value;
	const [, sign, h, m] = /GMT([+-])(\d{2}):(\d{2})/.exec(name ?? '') ?? ['', '+', '00', '00'];
	const offsetMin = (sign === '-' ? -1 : 1) * (Number(h) * 60 + Number(m));
	return new Date(guess - offsetMin * 60_000).toISOString();
}

type Who = keyof typeof CALENDARS;

export function sampleCalendar(now = new Date()): CalendarData {
	const day = (offset: number) => dayKey(now, offset);
	let n = 0;
	const timed = (who: Who, offset: number, title: string, from: [number, number], to: [number, number], location: string | null = null): CalendarEvent => ({
		id: `sample-${n++}`,
		title,
		start: at(day(offset), ...from),
		end: at(day(offset), ...to),
		allDay: false,
		location,
		...CALENDARS[who]
	});
	const allDay = (who: Who, offset: number, days: number, title: string, location: string | null = null): CalendarEvent => ({
		id: `sample-${n++}`,
		title,
		start: day(offset),
		end: day(offset + days),
		allDay: true,
		location,
		...CALENDARS[who]
	});

	const events = [
		allDay('family', 0, 1, 'Biojäte'),
		timed('jari', 0, 'Aamulenkki', [7, 0], [7, 45], 'Laajalahti'),
		timed('jari', 0, 'Hammaslääkäri', [10, 30], [11, 15], 'Oral Hammaslääkärit, Leppävaara'),
		timed('school', 0, 'Uintitunti', [13, 0], [14, 30], 'Leppävaaran uimahalli'),
		timed('hobbies', 0, 'Jalkapallotreenit', [17, 30], [19, 0], 'Leppävaaran stadion'),
		timed('family', 0, 'Saunailta', [20, 0], [21, 30]),
		timed('school', 1, 'Vanhempainilta', [18, 0], [19, 30], 'Mäkkylän koulu'),
		allDay('family', 2, 3, 'Mummo kylässä'),
		timed('hobbies', 2, 'Pianotunti', [16, 15], [17, 0], 'Musiikkiopisto'),
		timed('family', 4, 'Pizza- ja leffailta', [18, 0], [21, 0]),
		allDay('family', 5, 2, 'Mökkiviikonloppu', 'Ristiina'),
		timed('jari', 7, 'Auto huoltoon', [8, 0], [9, 0], 'Autotalo, Espoo'),
		timed('hobbies', 8, 'Jalkapallotreenit', [17, 30], [19, 0], 'Leppävaaran stadion'),
		allDay('school', 10, 1, 'Retkipäivä, eväät mukaan'),
		timed('family', 12, 'Synttärit', [14, 0], [17, 0], 'Mummola, Ristiina')
	];
	events.sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
	return { timeZone: TIME_ZONE, events, updatedAt: Date.now() };
}

/** All-day events sort before timed events of the same day. */
const sortKey = (e: CalendarEvent) => (e.allDay ? `${e.start}T00:00:00.000Z!` : e.start);
