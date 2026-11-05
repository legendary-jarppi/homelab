// Google Calendar API as a service account (secret dashboard-calendar: GOOGLE_SERVICE_ACCOUNT, the
// account's JSON key, and CALENDAR_ID). The family calendar is shared with the account's email with
// "Make changes to events"; the scope covers events only.
import { createSign } from 'node:crypto';
import { config } from '$lib/server/config';

const SCOPE = 'https://www.googleapis.com/auth/calendar.events';
const API = 'https://www.googleapis.com/calendar/v3';

interface ServiceAccount {
	client_email: string;
	private_key: string;
	token_uri: string;
}

/**
 * Start or end: `date` for all-day events (end exclusive), otherwise `dateTime` (RFC 3339). In a
 * patch, null clears a field (an all-day event becoming timed drops its `date`).
 */
export interface GoogleTime {
	date?: string | null;
	dateTime?: string | null;
	timeZone?: string | null;
}

export interface GoogleEvent {
	id: string;
	status?: string;
	summary?: string;
	description?: string;
	location?: string;
	start: GoogleTime;
	end: GoogleTime;
	/** Set on an occurrence of a repeating event (listed with singleEvents). */
	recurringEventId?: string;
}

export class GoogleCalendarError extends Error {
	constructor(
		readonly status: number,
		message: string
	) {
		super(message);
	}
}

export const googleCalendarConfigured = () => config.googleServiceAccount !== '' && config.calendarId !== '';

let account: ServiceAccount | null = null;
let token: { value: string; expiresAt: number } | null = null;

/** OAuth access token from a self-signed JWT (two-legged service account flow), reused until near expiry. */
async function accessToken(): Promise<string> {
	if (token && token.expiresAt > Date.now() + 60_000) return token.value;
	account ??= JSON.parse(config.googleServiceAccount) as ServiceAccount;
	const now = Math.floor(Date.now() / 1000);
	const part = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
	const unsigned = `${part({ alg: 'RS256', typ: 'JWT' })}.${part({ iss: account.client_email, scope: SCOPE, aud: account.token_uri, iat: now, exp: now + 3600 })}`;
	const signature = createSign('RSA-SHA256').update(unsigned).sign(account.private_key, 'base64url');
	const response = await fetch(account.token_uri, {
		method: 'POST',
		headers: { 'content-type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${signature}` }),
		signal: AbortSignal.timeout(10_000)
	});
	if (!response.ok) throw new Error(`Google token: HTTP ${response.status} ${(await response.text()).slice(0, 200)}`);
	const body = (await response.json()) as { access_token: string; expires_in: number };
	token = { value: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 };
	return token.value;
}

async function call<T>(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, body?: object): Promise<T> {
	const response = await fetch(`${API}/calendars/${encodeURIComponent(config.calendarId)}${path}`, {
		method,
		headers: { authorization: `Bearer ${await accessToken()}`, ...(body ? { 'content-type': 'application/json' } : {}) },
		body: body ? JSON.stringify(body) : undefined,
		signal: AbortSignal.timeout(10_000)
	});
	if (response.status === 401) token = null;
	if (!response.ok) throw new GoogleCalendarError(response.status, `Google Calendar: HTTP ${response.status} ${(await response.text()).slice(0, 200)}`);
	// DELETE answers 204 with no body.
	return (response.status === 204 ? undefined : await response.json()) as T;
}

/** Occurrences overlapping [from, to), recurring events expanded by Google; `summary` is the calendar's name. */
export async function listEvents(from: Date, to: Date): Promise<{ summary: string; items: GoogleEvent[] }> {
	const items: GoogleEvent[] = [];
	let summary = 'Calendar';
	let pageToken: string | undefined;
	do {
		const query = new URLSearchParams({ singleEvents: 'true', orderBy: 'startTime', timeMin: from.toISOString(), timeMax: to.toISOString(), maxResults: '250' });
		if (pageToken) query.set('pageToken', pageToken);
		const page = await call<{ summary?: string; items?: GoogleEvent[]; nextPageToken?: string }>('GET', `/events?${query}`);
		summary = page.summary || summary;
		items.push(...(page.items ?? []));
		pageToken = page.nextPageToken;
	} while (pageToken && items.length < 2000);
	return { summary, items };
}

export async function insertEvent(event: Omit<GoogleEvent, 'id' | 'status'>): Promise<GoogleEvent> {
	return call<GoogleEvent>('POST', '/events', event);
}

/** Changes only the given fields; on an occurrence id, only that occurrence of a repeating event. */
export async function patchEvent(id: string, patch: Partial<Omit<GoogleEvent, 'id' | 'status' | 'recurringEventId'>>): Promise<GoogleEvent> {
	return call<GoogleEvent>('PATCH', `/events/${encodeURIComponent(id)}`, patch);
}

/** Deletes an event; on an occurrence id, only that occurrence (Google cancels it in the series). */
export async function deleteEvent(id: string): Promise<void> {
	await call<void>('DELETE', `/events/${encodeURIComponent(id)}`);
}
