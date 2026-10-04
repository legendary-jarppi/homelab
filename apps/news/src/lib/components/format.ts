// Dates as a Helsinki newspaper prints them, in English. Runs on server and client alike.
const TIME_ZONE = 'Europe/Helsinki';

const timeFmt = new Intl.DateTimeFormat('en-GB', { timeZone: TIME_ZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const datelineFmt = new Intl.DateTimeFormat('en-GB', { timeZone: TIME_ZONE, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const dayKeyFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' });
const shortDateFmt = new Intl.DateTimeFormat('en-GB', { timeZone: TIME_ZONE, day: 'numeric', month: 'short' });
const longDateFmt = new Intl.DateTimeFormat('en-GB', { timeZone: TIME_ZONE, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

/** 12:00 */
export function clock(d: Date): string {
	return timeFmt.format(d);
}

/** Sunday 4 October 2026 */
export function dateline(d: Date): string {
	return datelineFmt.format(d);
}

/** Byline time: "14:05" today, "Yesterday 18:20", otherwise "3 Oct 18:20". */
export function when(d: Date, now = new Date()): string {
	const day = dayKeyFmt.format(d);
	if (day === dayKeyFmt.format(now)) return clock(d);
	if (day === dayKeyFmt.format(new Date(now.getTime() - 86_400_000))) return `Yesterday ${clock(d)}`;
	return `${shortDateFmt.format(d)} ${clock(d)}`;
}

/** Sunday 4 October 2026 at 14:05 (for datetime titles). */
export function fullDate(d: Date): string {
	return longDateFmt.format(d);
}
