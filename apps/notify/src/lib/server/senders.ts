// Apps that may send: one file per app in SENDERS_DIR (the mounted secret notify-senders), named after
// the app, containing its bearer token. Read on each request, so adding a sender needs no restart.
import { createHash, timingSafeEqual } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { config } from './config';

const digest = (s: string) => createHash('sha256').update(s).digest();

/** The sender whose token matches the Authorization header, or null. */
export async function senderFor(authorization: string | null): Promise<string | null> {
	const given = digest(authorization ?? '');
	let names: string[];
	try {
		// Kubernetes' ..data / ..2026_… entries are skipped by the name pattern.
		names = (await readdir(config.sendersDir)).filter((n) => /^[a-z0-9-]+$/.test(n));
	} catch {
		return null;
	}
	let match: string | null = null;
	for (const name of names) {
		const token = (await readFile(path.join(config.sendersDir, name), 'utf8')).trim();
		// Every token is compared (constant time), so timing does not reveal which sender matched.
		if (token.length >= 32 && timingSafeEqual(given, digest(`Bearer ${token}`))) match = name;
	}
	return match;
}
