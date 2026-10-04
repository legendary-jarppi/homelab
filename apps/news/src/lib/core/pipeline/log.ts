// Worker logs: one logfmt line per event. Counts, ids, latencies and tokens only; never article
// text, prompts or keys.

type Field = string | number | boolean | null | undefined;

function format(value: Field): string {
	if (value === null || value === undefined) return '-';
	const s = String(value);
	return /[\s"=]/.test(s) ? JSON.stringify(s) : s;
}

function line(level: string, event: string, fields: Record<string, Field>): string {
	const parts = [new Date().toISOString(), level, event];
	for (const [k, v] of Object.entries(fields)) if (v !== undefined) parts.push(`${k}=${format(v)}`);
	return parts.join(' ');
}

export const log = {
	info: (event: string, fields: Record<string, Field> = {}) => console.log(line('info', event, fields)),
	warn: (event: string, fields: Record<string, Field> = {}) => console.warn(line('warn', event, fields)),
	error: (event: string, fields: Record<string, Field> = {}) => console.error(line('error', event, fields))
};

/** Error message for logs and *_error columns, single line and bounded. */
export function errorText(e: unknown, max = 300): string {
	const message = e instanceof Error ? e.message : String(e);
	return message.replace(/\s+/g, ' ').slice(0, max);
}
