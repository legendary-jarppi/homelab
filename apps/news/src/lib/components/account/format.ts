const WHEN = new Intl.DateTimeFormat('en-GB', {
	timeZone: 'Europe/Helsinki',
	weekday: 'short',
	day: 'numeric',
	month: 'short',
	hour: '2-digit',
	minute: '2-digit'
});

/** Admin timestamps, always in Helsinki time regardless of the viewing device. */
export function when(date: Date | string | null | undefined): string {
	return date ? WHEN.format(new Date(date)) : '–';
}

export function percent(share: number | null): string {
	return share === null ? '–' : `${Math.round(share * 100)} %`;
}

export const INTENSITY_LABELS = ['removed', 'mention', 'description', 'graphic'] as const;
