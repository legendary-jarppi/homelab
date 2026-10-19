// Finnish date formats for the dashboard (the rest of the UI text is English).

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** "Maanantai 5. lokakuuta" */
export function longDate(date: Date): string {
	return capitalize(date.toLocaleDateString('fi-FI', { weekday: 'long', day: 'numeric', month: 'long' }));
}

/** Weekday abbreviation of a "YYYY-MM-DD" day: "ma", "ti", … */
export function weekdayShort(key: string): string {
	return new Date(`${key}T12:00:00Z`).toLocaleDateString('fi-FI', { weekday: 'short', timeZone: 'UTC' });
}

/** "ke 7.10." for a "YYYY-MM-DD" day. */
export function shortDay(key: string): string {
	const [, m, d] = key.split('-').map(Number);
	return `${weekdayShort(key)} ${d}.${m}.`;
}

const ZONE = 'Europe/Helsinki';

/**
 * "14:32" today, "ti 7.10. 14:32" otherwise. Instants with an offset are shown in Finnish time;
 * wall times without a zone (carriers' local time) are shown as given.
 */
export function eventTime(value: string, now = new Date()): string {
	let key: string;
	let hhmm: string;
	if (/(Z|[+-]\d{2}:?\d{2})$/.test(value)) {
		const d = new Date(value);
		key = new Intl.DateTimeFormat('en-CA', { timeZone: ZONE }).format(d);
		hhmm = new Intl.DateTimeFormat('en-GB', { timeZone: ZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d);
	} else {
		key = value.slice(0, 10);
		hhmm = value.slice(11, 16);
	}
	const today = new Intl.DateTimeFormat('en-CA', { timeZone: ZONE }).format(now);
	if (!hhmm) return key === today ? 'tänään' : shortDay(key);
	return key === today ? hhmm : `${shortDay(key)} ${hhmm}`;
}

/** "ke 8.10." for a date or instant (ETA, pickup deadline). */
export function dayOf(value: string): string {
	const key = /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : new Intl.DateTimeFormat('en-CA', { timeZone: ZONE }).format(new Date(value));
	return shortDay(key);
}

/** "14:32" in Finnish time for a unix ms instant. */
export function clock(ms: number): string {
	return new Intl.DateTimeFormat('en-GB', { timeZone: ZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(ms);
}

/** "14:32:05" today, "ti 7.10. 14:32:05" otherwise, in Finnish time: a position in recorded video. */
export function instantTime(ms: number, now = Date.now()): string {
	const day = new Intl.DateTimeFormat('en-CA', { timeZone: ZONE });
	const hms = new Intl.DateTimeFormat('en-GB', { timeZone: ZONE, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(ms);
	return day.format(ms) === day.format(now) ? hms : `${shortDay(day.format(ms))} ${hms}`;
}

/** Finnish time's offset from UTC at an instant, ms (+3 h in summer, +2 h in winter). */
export function zoneOffsetMs(ms: number): number {
	const name = new Intl.DateTimeFormat('en-US', { timeZone: ZONE, timeZoneName: 'longOffset' }).formatToParts(ms).find((p) => p.type === 'timeZoneName')?.value ?? '';
	const m = /([+-])(\d{2}):(\d{2})/.exec(name);
	return m ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) * 60_000 : 0;
}
