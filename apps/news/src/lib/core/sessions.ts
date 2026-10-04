// Subscriber sessions: per-outlet cookie jars, seeded from the secret value COOKIES_<SLUG> (a
// browser's Cookie header for the outlet), sent only to that outlet's own hosts, updated from
// Set-Cookie and persisted in outlet_sessions. Used by the worker only.
import { createHash } from 'node:crypto';
import type { Sql } from './db.ts';

export class CookieJar {
	readonly domain: string;
	private readonly cookies: Map<string, string>;
	dirty = false;

	/** `domain`: registrable domain such as 'hs.fi'; matches it and its subdomains, over https only. */
	constructor(domain: string, cookies: Record<string, string>) {
		this.domain = domain.toLowerCase();
		this.cookies = new Map(Object.entries(cookies));
	}

	/** Parses a Cookie request header ("a=1; b=2"). */
	static parseHeader(header: string): Record<string, string> {
		const out: Record<string, string> = {};
		for (const part of header.split(';')) {
			const eq = part.indexOf('=');
			if (eq <= 0) continue;
			const name = part.slice(0, eq).trim();
			if (name) out[name] = part.slice(eq + 1).trim();
		}
		return out;
	}

	matches(url: URL): boolean {
		const host = url.hostname.toLowerCase();
		return url.protocol === 'https:' && (host === this.domain || host.endsWith(`.${this.domain}`));
	}

	header(url: URL): string | null {
		if (!this.matches(url) || this.cookies.size === 0) return null;
		return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
	}

	/** Applies Set-Cookie headers from a response of `url` (ignored for other sites). */
	store(url: URL, setCookies: string[]): void {
		if (!this.matches(url)) return;
		for (const line of setCookies) {
			const [pair, ...attrs] = line.split(';');
			const eq = pair.indexOf('=');
			if (eq <= 0) continue;
			const name = pair.slice(0, eq).trim();
			const value = pair.slice(eq + 1).trim();
			const attr = new Map(
				attrs.map((a) => {
					const i = a.indexOf('=');
					return i < 0 ? [a.trim().toLowerCase(), ''] : [a.slice(0, i).trim().toLowerCase(), a.slice(i + 1).trim()];
				})
			);
			const cookieDomain = attr.get('domain')?.replace(/^\./, '').toLowerCase();
			if (cookieDomain && cookieDomain !== this.domain && !cookieDomain.endsWith(`.${this.domain}`)) continue;
			const maxAge = attr.get('max-age');
			const expires = attr.get('expires');
			const expired = (maxAge !== undefined && Number(maxAge) <= 0) || (expires !== undefined && Date.parse(expires) <= Date.now());
			if (expired) {
				if (this.cookies.delete(name)) this.dirty = true;
			} else if (this.cookies.get(name) !== value) {
				this.cookies.set(name, value);
				this.dirty = true;
			}
		}
	}

	toJSON(): Record<string, string> {
		return Object.fromEntries(this.cookies);
	}
}

const jars = new Map<string, CookieJar>();

/** The outlet's subscriber session, or null when none is configured. */
export function sessionFor(slug: string): CookieJar | null {
	return jars.get(slug) ?? null;
}

const seedFor = (slug: string) => process.env[`COOKIES_${slug.toUpperCase()}`]?.trim() || null;
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

/**
 * Loads jars for outlets that have a COOKIES_<SLUG> secret. A changed secret value reseeds the
 * jar (the admin pasted fresh cookies); otherwise the stored, Set-Cookie-updated jar is used.
 * Rows for outlets whose secret was removed are deleted.
 */
export async function initSessions(sql: Sql, outlets: { slug: string; homepage: string }[]): Promise<string[]> {
	jars.clear();
	const configured: string[] = [];
	for (const { slug, homepage } of outlets) {
		const seed = seedFor(slug);
		if (!seed) {
			await sql`DELETE FROM outlet_sessions WHERE slug = ${slug}`;
			continue;
		}
		const domain = new URL(homepage).hostname.replace(/^www\./, '');
		const hash = sha256(seed);
		const [row] = await sql<{ seed_hash: string; cookies: Record<string, string> }[]>`SELECT seed_hash, cookies FROM outlet_sessions WHERE slug = ${slug}`;
		if (row && row.seed_hash === hash) {
			jars.set(slug, new CookieJar(domain, row.cookies));
		} else {
			const cookies = CookieJar.parseHeader(seed);
			await sql`
				INSERT INTO outlet_sessions (slug, seed_hash, cookies) VALUES (${slug}, ${hash}, ${sql.json(cookies)})
				ON CONFLICT (slug) DO UPDATE SET seed_hash = EXCLUDED.seed_hash, cookies = EXCLUDED.cookies,
					state = 'unknown', state_at = NULL, state_url = NULL, updated_at = now()`;
			jars.set(slug, new CookieJar(domain, cookies));
		}
		configured.push(slug);
	}
	return configured;
}

/** Writes jars changed by Set-Cookie since the last call. */
export async function persistSessions(sql: Sql): Promise<void> {
	for (const [slug, jar] of jars) {
		if (!jar.dirty) continue;
		jar.dirty = false;
		await sql`UPDATE outlet_sessions SET cookies = ${sql.json(jar.toJSON())}, updated_at = now() WHERE slug = ${slug}`;
	}
}

/** Records whether a subscriber-only article opened with the session. */
export async function recordSessionCheck(sql: Sql, slug: string, ok: boolean, url: string): Promise<void> {
	await sql`
		UPDATE outlet_sessions SET state = ${ok ? 'ok' : 'rejected'}, state_at = now(), state_url = ${url}
		WHERE slug = ${slug}`;
}
