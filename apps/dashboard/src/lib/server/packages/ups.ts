// UPS: Tracking API v1 (developer.ups.com) with an OAuth client-credentials app,
// UPS_CLIENT_ID / UPS_CLIENT_SECRET.
import { randomUUID } from 'node:crypto';
import { config } from '$lib/server/config';
import type { PackageEvent, PackageState, PackageTracking } from '$lib/types';
import { NotConfiguredError, NotFoundError } from './errors';

const BASE = 'https://onlinetools.ups.com';

interface UpsActivity {
	date?: string;
	time?: string;
	location?: { address?: { city?: string; countryCode?: string } };
	status?: { type?: string; description?: string; code?: string };
}

let token: { value: string; expiresAt: number } | null = null;

async function accessToken(): Promise<string> {
	if (token && token.expiresAt > Date.now() + 60_000) return token.value;
	const basic = Buffer.from(`${config.upsClientId}:${config.upsClientSecret}`).toString('base64');
	const response = await fetch(`${BASE}/security/v1/oauth/token`, {
		method: 'POST',
		headers: { authorization: `Basic ${basic}`, 'content-type': 'application/x-www-form-urlencoded' },
		body: 'grant_type=client_credentials',
		signal: AbortSignal.timeout(10_000)
	});
	if (!response.ok) throw new Error(`UPS token: HTTP ${response.status}`);
	const body = (await response.json()) as { access_token: string; expires_in: string | number };
	token = { value: body.access_token, expiresAt: Date.now() + Number(body.expires_in) * 1000 };
	return token.value;
}

/** "20261005" + "143200" → local wall time "2026-10-05T14:32:00" (UPS gives no zone). */
function wallTime(date?: string, time?: string): string | null {
	if (!date || date.length !== 8) return null;
	const t = (time ?? '000000').padEnd(6, '0');
	return `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T${t.slice(0, 2)}:${t.slice(2, 4)}:${t.slice(4, 6)}`;
}

/** Activity status types: M manifest, P pickup, I in transit, X exception, D delivered, O out for delivery. */
function stateOf(a: UpsActivity | undefined): PackageState {
	if (!a?.status) return 'unknown';
	const text = (a.status.description ?? '').toUpperCase();
	if (/ACCESS POINT/.test(text) && !/PICKED UP BY/.test(text)) return a.status.type === 'D' ? 'pickup' : 'transit';
	switch (a.status.type) {
		case 'D':
			return 'delivered';
		case 'X':
			return 'exception';
		case 'M':
			return 'info';
		case 'O':
			return 'out';
	}
	return /OUT FOR DELIVERY/.test(text) ? 'out' : 'transit';
}

const tidy = (s: string) => (s === s.toUpperCase() ? s.charAt(0) + s.slice(1).toLowerCase() : s).trim();

export async function trackUps(code: string): Promise<PackageTracking> {
	if (!config.upsClientId || !config.upsClientSecret) throw new NotConfiguredError('UPS API credentials not set');
	const response = await fetch(`${BASE}/api/track/v1/details/${encodeURIComponent(code)}?locale=en_US&returnSignature=false`, {
		headers: { authorization: `Bearer ${await accessToken()}`, transId: randomUUID(), transactionSrc: 'home-dashboard' },
		signal: AbortSignal.timeout(15_000)
	});
	if (response.status === 401) token = null;
	if (response.status === 404) throw new NotFoundError();
	if (!response.ok) throw new Error(`UPS: HTTP ${response.status}`);
	const body = (await response.json()) as {
		trackResponse?: {
			shipment?: {
				warnings?: { message?: string }[];
				package?: { activity?: UpsActivity[]; deliveryDate?: { type?: string; date?: string }[] }[];
			}[];
		};
	};
	const pkg = body.trackResponse?.shipment?.[0]?.package?.[0];
	if (!pkg) throw new NotFoundError();

	const activity = pkg.activity ?? [];
	const events: PackageEvent[] = activity.map((a) => ({
		time: wallTime(a.date, a.time),
		description: tidy(a.status?.description || 'Event'),
		location: [a.location?.address?.city, a.location?.address?.countryCode].filter(Boolean).map((s) => tidy(s!)).join(', ') || null
	}));
	const state = stateOf(activity[0]);
	const scheduled = pkg.deliveryDate?.find((d) => d.type === 'SDD' || d.type === 'RDD')?.date;
	return {
		state,
		summary: events[0]?.description ?? null,
		events,
		eta: state === 'delivered' || !scheduled ? null : `${scheduled.slice(0, 4)}-${scheduled.slice(4, 6)}-${scheduled.slice(6, 8)}`,
		pickup: null
	};
}
