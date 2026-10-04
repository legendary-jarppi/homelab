// Editions: fixed daily cutoffs (Europe/Helsinki). The front page shows articles classified before
// the current edition's cutoff, so it changes a few times a day instead of every few minutes.
import type { Sql } from './db.ts';

export const TIME_ZONE = process.env.EDITION_TIME_ZONE ?? 'Europe/Helsinki';

export interface EditionSlot {
	hour: number;
	minute: number;
	label: string;
}

/** EDITIONS="06:30 Morning,12:00 Midday,17:00 Evening" */
export function editionSlots(spec = process.env.EDITIONS ?? '06:30 Morning,12:00 Midday,17:00 Evening'): EditionSlot[] {
	return spec
		.split(',')
		.map((s) => s.trim().match(/^(\d{1,2}):(\d{2})\s+(.+)$/))
		.filter((m): m is RegExpMatchArray => m !== null)
		.map((m) => ({ hour: Number(m[1]), minute: Number(m[2]), label: `${m[3].trim()} Edition` }))
		.sort((a, b) => a.hour * 60 + a.minute - (b.hour * 60 + b.minute));
}

/** Wall-clock parts of `instant` in TIME_ZONE. */
function zonedParts(instant: Date): { year: number; month: number; day: number; hour: number; minute: number } {
	const parts = Object.fromEntries(
		new Intl.DateTimeFormat('en-GB', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
			.formatToParts(instant)
			.map((p) => [p.type, Number(p.value)])
	);
	return { year: parts.year, month: parts.month, day: parts.day, hour: parts.hour, minute: parts.minute };
}

/** The instant at which TIME_ZONE's clock shows the given local date and time. */
export function zonedInstant(year: number, month: number, day: number, hour: number, minute: number): Date {
	const wanted = Date.UTC(year, month - 1, day, hour, minute);
	let guess = wanted;
	// Two passes converge across DST offsets.
	for (let i = 0; i < 2; i++) {
		const p = zonedParts(new Date(guess));
		guess += wanted - Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
	}
	return new Date(guess);
}

/** The most recent scheduled edition at or before `now`. */
export function latestSlot(now: Date, slots = editionSlots()): { cutoff: Date; label: string } {
	const today = zonedParts(now);
	for (let back = 0; back < 2; back++) {
		const day = new Date(Date.UTC(today.year, today.month - 1, today.day - back));
		for (const slot of [...slots].reverse()) {
			const cutoff = zonedInstant(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), slot.hour, slot.minute);
			if (cutoff <= now) return { cutoff, label: slot.label };
		}
	}
	throw new Error('no edition slots configured');
}

/** Records the latest due edition if it does not exist yet; returns true when a new edition was created. */
export async function ensureEdition(sql: Sql, now = new Date()): Promise<boolean> {
	const { cutoff, label } = latestSlot(now);
	const rows = await sql`INSERT INTO editions (cutoff, label) VALUES (${cutoff}, ${label}) ON CONFLICT (cutoff) DO NOTHING RETURNING id`;
	return rows.length > 0;
}

export interface Edition {
	id: number;
	cutoff: Date;
	label: string;
}

export async function currentEdition(sql: Sql): Promise<Edition | null> {
	const rows = await sql<Edition[]>`SELECT id, cutoff, label FROM editions ORDER BY cutoff DESC LIMIT 1`;
	return rows[0] ?? null;
}
