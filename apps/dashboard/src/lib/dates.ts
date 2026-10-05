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
