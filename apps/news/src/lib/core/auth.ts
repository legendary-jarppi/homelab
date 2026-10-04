// Accounts: scrypt password hashes, database sessions (token hash only), single-use invites.
import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from 'node:crypto';
import type { Sql } from './db.ts';

const SCRYPT = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 } satisfies ScryptOptions;
const SESSION_DAYS = 180;
const INVITE_DAYS = 14;

function scrypt(password: string, salt: Buffer): Promise<Buffer> {
	const { promise, resolve, reject } = Promise.withResolvers<Buffer>();
	scryptCb(password.normalize('NFKC'), salt, 64, SCRYPT, (err, key) => (err ? reject(err) : resolve(key)));
	return promise;
}

export async function hashPassword(password: string): Promise<string> {
	const salt = randomBytes(16);
	const key = await scrypt(password, salt);
	return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
	const [scheme, , , , salt, hash] = stored.split('$');
	if (scheme !== 'scrypt' || !salt || !hash) return false;
	const expected = Buffer.from(hash, 'base64');
	const actual = await scrypt(password, Buffer.from(salt, 'base64'));
	return actual.length === expected.length && timingSafeEqual(actual, expected);
}

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

export interface SessionUser {
	id: number;
	username: string;
	displayName: string;
	role: 'reader' | 'admin';
	settings: unknown;
}

export async function createSession(sql: Sql, userId: number, userAgent: string | null): Promise<{ token: string; maxAgeS: number }> {
	const token = randomBytes(32).toString('base64url');
	await sql`
		INSERT INTO sessions (token_hash, user_id, expires_at, user_agent)
		VALUES (${sha256(token)}, ${userId}, now() + make_interval(days => ${SESSION_DAYS}), ${userAgent?.slice(0, 200) ?? null})`;
	return { token, maxAgeS: SESSION_DAYS * 86400 };
}

/** Resolves a session token; slides the expiry forward when less than half the lifetime remains. */
export async function sessionUser(sql: Sql, token: string | undefined): Promise<SessionUser | null> {
	if (!token) return null;
	const rows = await sql<{ id: number; username: string; display_name: string; role: 'reader' | 'admin'; settings: unknown; renew: boolean }[]>`
		SELECT u.id, u.username, u.display_name, u.role, u.settings,
			s.expires_at < now() + make_interval(days => ${SESSION_DAYS / 2}) AS renew
		FROM sessions s JOIN users u ON u.id = s.user_id
		WHERE s.token_hash = ${sha256(token)} AND s.expires_at > now()`;
	const row = rows[0];
	if (!row) return null;
	if (row.renew) {
		await sql`UPDATE sessions SET expires_at = now() + make_interval(days => ${SESSION_DAYS}), last_seen_at = now() WHERE token_hash = ${sha256(token)}`;
	}
	return { id: row.id, username: row.username, displayName: row.display_name, role: row.role, settings: row.settings };
}

export async function deleteSession(sql: Sql, token: string): Promise<void> {
	await sql`DELETE FROM sessions WHERE token_hash = ${sha256(token)}`;
}

/** Creates an invite; returns the one-time code (only its hash is stored). */
export async function createInvite(sql: Sql, opts: { createdBy: number | null; role: 'reader' | 'admin'; note?: string }): Promise<string> {
	const code = randomBytes(18).toString('base64url');
	await sql`
		INSERT INTO invites (code_hash, created_by, role, note, expires_at)
		VALUES (${sha256(code)}, ${opts.createdBy}, ${opts.role}, ${opts.note ?? null}, now() + make_interval(days => ${INVITE_DAYS}))`;
	return code;
}

export interface InviteInfo {
	role: 'reader' | 'admin';
	note: string | null;
}

/** An unused, unexpired invite, or null. */
export async function findInvite(sql: Sql, code: string): Promise<InviteInfo | null> {
	const rows = await sql<InviteInfo[]>`
		SELECT role, note FROM invites WHERE code_hash = ${sha256(code)} AND used_at IS NULL AND expires_at > now()`;
	return rows[0] ?? null;
}

export class SignupError extends Error {}

/** Creates the account and consumes the invite atomically. */
export async function redeemInvite(sql: Sql, code: string, account: { username: string; displayName: string; password: string }): Promise<number> {
	const passwordHash = await hashPassword(account.password);
	return sql.begin(async (tx) => {
		const [invite] = await tx<{ role: 'reader' | 'admin'; created_by: number | null }[]>`
			SELECT role, created_by FROM invites
			WHERE code_hash = ${sha256(code)} AND used_at IS NULL AND expires_at > now()
			FOR UPDATE`;
		if (!invite) throw new SignupError('This invite link has expired or was already used.');
		const taken = await tx`SELECT 1 FROM users WHERE lower(username) = lower(${account.username})`;
		if (taken.length > 0) throw new SignupError('That username is taken.');
		const [user] = await tx<{ id: number }[]>`
			INSERT INTO users (username, display_name, password_hash, role, invited_by)
			VALUES (${account.username}, ${account.displayName}, ${passwordHash}, ${invite.role}, ${invite.created_by})
			RETURNING id`;
		await tx`UPDATE invites SET used_by = ${user.id}, used_at = now() WHERE code_hash = ${sha256(code)}`;
		return user.id;
	});
}
