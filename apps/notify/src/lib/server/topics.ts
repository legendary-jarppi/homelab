import { readFileSync } from 'node:fs';
import { config } from './config';

export interface Topic {
	id: string;
	name: string;
	description: string;
	/** Whether people get it until they choose otherwise. */
	default: boolean;
}

let cached: Topic[] | null = null;

/** deploy/topics.json, read once; a malformed file stops the app at startup (hooks init). */
export function topics(): Topic[] {
	if (cached) return cached;
	const raw = JSON.parse(readFileSync(config.topicsFile, 'utf8')) as unknown;
	if (!Array.isArray(raw)) throw new Error(`${config.topicsFile}: expected a JSON array`);
	cached = raw.map((t, i): Topic => {
		if (typeof t?.id !== 'string' || !/^[a-z0-9-]+$/.test(t.id) || typeof t.name !== 'string') {
			throw new Error(`${config.topicsFile}: topic ${i} needs an id (a-z, 0-9, -) and a name`);
		}
		return { id: t.id, name: t.name, description: typeof t.description === 'string' ? t.description : '', default: t.default !== false };
	});
	return cached;
}

export const topic = (id: string) => topics().find((t) => t.id === id) ?? null;
