// Posti: the public tracking that posti.fi uses (no account). An anonymous token from Posti's auth
// service; its role token goes in Authorization, the id token in X-Posti-Token.
import type { PackageEvent, PackageState, PackageTracking } from '$lib/types';
import { NotFoundError } from './errors';

const QUERY = `query SearchShipments($searchTerms: [String!]!) {
  consumerSearchShipments(page: 1, pageSize: 5, type: PUBLIC_SHIPMENTS, searchTerms: $searchTerms, locale: "fi") {
    hits {
      displayId
      status { main subStatus exception }
      delivery { result time { type timestamp timestampLatest } }
      pickupPoint { status lastCollectionDate address { publicName streetAddress postcode city } }
      events { city eventDescription reasonDescription timestamp }
    }
  }
}`;

interface Hit {
	displayId: string | null;
	status: { main: string | null; subStatus: string | null; exception: string | null } | null;
	delivery: { result: string | null; time: { type: string | null; timestamp: string | null; timestampLatest: string | null } | null } | null;
	pickupPoint: {
		status: string | null;
		lastCollectionDate: string | null;
		address: { publicName: string | null; streetAddress: string | null; postcode: string | null; city: string | null } | null;
	} | null;
	events: { city: string | null; eventDescription: string | null; reasonDescription: string | null; timestamp: string | null }[] | null;
}

let token: { authorization: string; idToken: string; expiresAt: number } | null = null;

async function tokens() {
	if (token && token.expiresAt > Date.now() + 60_000) return token;
	const response = await fetch('https://auth-service.posti.fi/api/v1/anonymous_token', { method: 'POST', signal: AbortSignal.timeout(10_000) });
	if (!response.ok) throw new Error(`Posti token: HTTP ${response.status}`);
	const body = (await response.json()) as { id_token: string; role_tokens: { type: string; token: string }[] };
	const role = body.role_tokens.find((r) => r.type === 'anonymous')?.token;
	if (!role) throw new Error('Posti token: no anonymous role token');
	const { exp } = JSON.parse(Buffer.from(body.id_token.split('.')[1], 'base64url').toString()) as { exp: number };
	token = { authorization: role, idToken: body.id_token, expiresAt: exp * 1000 };
	return token;
}

/** Posti's status enums are not documented; matched loosely, with the latest event as the fallback. */
function stateOf(hit: Hit): PackageState {
	const s = [hit.status?.main, hit.status?.subStatus, hit.delivery?.result].filter(Boolean).join(' ').toUpperCase();
	if (hit.status?.exception || /RETURN|FAIL|EXCEPTION|REFUSED/.test(s)) return 'exception';
	if (/DELIVERED/.test(s)) return 'delivered';
	if (/READY_FOR_PICKUP|WAITING_FOR_PICKUP|IN_PICKUP|PICKUP_POINT/.test(s) || hit.pickupPoint?.status) return 'pickup';
	if (/OUT_FOR_DELIVERY|IN_DELIVERY/.test(s)) return 'out';
	if (/TRANSIT|TRANSPORT|ON_THE_WAY|RECEIVED|IN_PROGRESS|ARRIVED/.test(s)) return 'transit';
	if (/WAITING|CREATED|INFO|ANNOUNCED|REGISTERED|PRE/.test(s)) return 'info';
	return hit.events?.length ? 'transit' : 'unknown';
}

export async function trackPosti(code: string): Promise<PackageTracking> {
	const t = await tokens();
	const response = await fetch('https://graphql.posti.fi/graphql', {
		method: 'POST',
		headers: { 'content-type': 'application/json', authorization: t.authorization, 'x-posti-token': `Bearer ${t.idToken}` },
		body: JSON.stringify({ operationName: 'SearchShipments', query: QUERY, variables: { searchTerms: [code] } }),
		signal: AbortSignal.timeout(15_000)
	});
	if (response.status === 401 || response.status === 403) token = null;
	if (!response.ok) throw new Error(`Posti: HTTP ${response.status}`);
	const body = (await response.json()) as { data?: { consumerSearchShipments?: { hits: Hit[] } }; errors?: { message: string }[] };
	if (body.errors?.length) throw new Error(`Posti: ${body.errors[0].message}`);
	const hits = body.data?.consumerSearchShipments?.hits ?? [];
	const hit = hits.find((h) => h.displayId?.toUpperCase() === code) ?? hits[0];
	if (!hit) throw new NotFoundError();

	const events: PackageEvent[] = (hit.events ?? [])
		.map((e) => ({
			time: e.timestamp,
			description: [e.eventDescription, e.reasonDescription].filter(Boolean).join(': ') || 'Event',
			location: e.city || null
		}))
		.sort((a, b) => (b.time ?? '').localeCompare(a.time ?? ''));
	const p = hit.pickupPoint;
	const address = p?.address ? [p.address.streetAddress, [p.address.postcode, p.address.city].filter(Boolean).join(' ')].filter(Boolean).join(', ') : null;
	const state = stateOf(hit);
	return {
		state,
		summary: events[0]?.description ?? null,
		events,
		eta: state === 'delivered' ? null : (hit.delivery?.time?.timestamp ?? null),
		pickup: state === 'pickup' && p?.address?.publicName ? { name: p.address.publicName, address: address || null, until: p.lastCollectionDate } : null
	};
}
