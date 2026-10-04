// Session cookie shared by SvelteKit (src/hooks.server.ts) and the WebSocket relay (server.js).
// Value: "<expiresAtMs>.<HMAC-SHA256(SESSION_SECRET, 'v1.<expiresAtMs>')>" (base64url).
// Rotating SESSION_SECRET logs out every device.
import { createHmac, timingSafeEqual } from 'node:crypto';

export const SESSION_COOKIE = 'dashboard_session';
/** Browsers cap cookie lifetime at 400 days; keep the iPad logged in for a year. */
export const SESSION_MAX_AGE_S = 365 * 24 * 60 * 60;

/** @returns {string} */
function secret() {
	const s = process.env.SESSION_SECRET;
	if (!s || s.length < 32) throw new Error('SESSION_SECRET must be set (>= 32 chars)');
	return s;
}

/** @param {string} expires */
function sign(expires) {
	return createHmac('sha256', secret()).update(`v1.${expires}`).digest('base64url');
}

/** @param {number} [now] */
export function createSession(now = Date.now()) {
	const expires = String(now + SESSION_MAX_AGE_S * 1000);
	return `${expires}.${sign(expires)}`;
}

/**
 * @param {string | undefined | null} value
 * @param {number} [now]
 */
export function verifySession(value, now = Date.now()) {
	if (!value) return false;
	const dot = value.indexOf('.');
	if (dot <= 0) return false;
	const expires = value.slice(0, dot);
	if (!/^\d+$/.test(expires) || Number(expires) < now) return false;
	const given = Buffer.from(value.slice(dot + 1));
	const expected = Buffer.from(sign(expires));
	return given.length === expected.length && timingSafeEqual(given, expected);
}

/**
 * Reads one cookie from a raw Cookie header (for the WebSocket upgrade path).
 * @param {string | undefined} header
 * @param {string} name
 */
export function readCookie(header, name) {
	if (!header) return undefined;
	for (const part of header.split(';')) {
		const eq = part.indexOf('=');
		if (eq > 0 && part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim());
	}
	return undefined;
}
