// Passcode session cookie (same scheme as apps/dashboard/session.js).
// Value: "<expiresAtMs>.<HMAC-SHA256(SESSION_SECRET, 'v1.<expiresAtMs>')>" (base64url).
// Rotating SESSION_SECRET logs out every device.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '$env/dynamic/private';

export const SESSION_COOKIE = 'workout_session';
/** Browsers cap cookie lifetime at 400 days; keep phones logged in for a year. */
export const SESSION_MAX_AGE_S = 365 * 24 * 60 * 60;

function sign(expires: string): string {
	const secret = env.SESSION_SECRET;
	if (!secret || secret.length < 32) throw new Error('SESSION_SECRET must be set (>= 32 chars)');
	return createHmac('sha256', secret).update(`v1.${expires}`).digest('base64url');
}

export function createSession(now = Date.now()): string {
	const expires = String(now + SESSION_MAX_AGE_S * 1000);
	return `${expires}.${sign(expires)}`;
}

export function verifySession(value: string | undefined, now = Date.now()): boolean {
	if (!value) return false;
	const dot = value.indexOf('.');
	if (dot <= 0) return false;
	const expires = value.slice(0, dot);
	if (!/^\d+$/.test(expires) || Number(expires) < now) return false;
	const given = Buffer.from(value.slice(dot + 1));
	const expected = Buffer.from(sign(expires));
	return given.length === expected.length && timingSafeEqual(given, expected);
}
