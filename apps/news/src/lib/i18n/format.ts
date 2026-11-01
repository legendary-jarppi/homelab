// Dates and times as a Helsinki newspaper prints them, in the reader's interface language.
// Runs on server and client alike.
import type { Locale } from './types';

const TIME_ZONE = 'Europe/Helsinki';
const TAG: Record<Locale, string> = { fi: 'fi-FI', en: 'en-GB' };

function formatters(locale: Locale) {
	const tag = TAG[locale];
	return {
		time: new Intl.DateTimeFormat(tag, { timeZone: TIME_ZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }),
		dateline: new Intl.DateTimeFormat(tag, { timeZone: TIME_ZONE, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
		// Finnish joins weekday and date in the essive ("sunnuntaina 1. marraskuuta"); a dateline wants "sunnuntai 1. marraskuuta".
		weekday: new Intl.DateTimeFormat(tag, { timeZone: TIME_ZONE, weekday: 'long' }),
		date: new Intl.DateTimeFormat(tag, { timeZone: TIME_ZONE, day: 'numeric', month: 'long', year: 'numeric' }),
		shortDate:
			locale === 'fi'
				? new Intl.DateTimeFormat(tag, { timeZone: TIME_ZONE, day: 'numeric', month: 'numeric' })
				: new Intl.DateTimeFormat(tag, { timeZone: TIME_ZONE, day: 'numeric', month: 'short' }),
		long: new Intl.DateTimeFormat(tag, {
			timeZone: TIME_ZONE,
			weekday: 'long',
			day: 'numeric',
			month: 'long',
			year: 'numeric',
			hour: '2-digit',
			minute: '2-digit',
			hourCycle: 'h23'
		})
	};
}

const FORMATTERS = { fi: formatters('fi'), en: formatters('en') };
const dayKey = new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' });
const capitalise = (s: string) => s.charAt(0).toLocaleUpperCase() + s.slice(1);

export interface DateFormat {
	/** 12:00 / 12.00 */
	clock(d: Date): string;
	/** Sunday 4 October 2026 / Sunnuntai 4. lokakuuta 2026 */
	dateline(d: Date): string;
	/** Byline time: "14:05" today, "Yesterday 18:20", otherwise "3 Oct 18:20" (fi: "14.05", "Eilen 18.20", "3.10. 18.20"). */
	when(d: Date, now?: Date): string;
	/** "Just now", "25 min ago" within the hour, otherwise as `when`. */
	ago(d: Date, now?: Date): string;
	/** Full date and time, for datetime titles. */
	fullDate(d: Date): string;
}

export function dateFormat(locale: Locale): DateFormat {
	const f = FORMATTERS[locale];
	const clock = (d: Date) => f.time.format(d);
	const when = (d: Date, now = new Date()) => {
		const day = dayKey.format(d);
		if (day === dayKey.format(now)) return clock(d);
		if (day === dayKey.format(new Date(now.getTime() - 86_400_000))) return `${locale === 'fi' ? 'Eilen' : 'Yesterday'} ${clock(d)}`;
		const date = f.shortDate.format(d);
		return `${locale === 'fi' && !date.endsWith('.') ? `${date}.` : date} ${clock(d)}`;
	};
	return {
		clock,
		dateline: (d) => capitalise(locale === 'fi' ? `${f.weekday.format(d)} ${f.date.format(d)}` : f.dateline.format(d)),
		when,
		ago(d, now = new Date()) {
			const minutes = Math.floor((now.getTime() - d.getTime()) / 60_000);
			if (minutes < 1) return locale === 'fi' ? 'Juuri nyt' : 'Just now';
			if (minutes < 60) return locale === 'fi' ? `${minutes} min sitten` : `${minutes} min ago`;
			return when(d, now);
		},
		fullDate: (d) => f.long.format(d)
	};
}
