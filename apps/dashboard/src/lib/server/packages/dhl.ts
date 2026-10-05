// DHL: Shipment Tracking - Unified API (developer.dhl.com), key in DHL_API_KEY.
// The free tier allows 250 calls a day, one per second.
import { config } from '$lib/server/config';
import type { PackageEvent, PackageState, PackageTracking } from '$lib/types';
import { NotConfiguredError, NotFoundError } from './errors';

interface DhlEvent {
	timestamp?: string;
	statusCode?: string;
	status?: string;
	description?: string;
	location?: { address?: { addressLocality?: string } };
}

function stateOf(e: DhlEvent | undefined): PackageState {
	if (!e) return 'unknown';
	const text = `${e.status ?? ''} ${e.description ?? ''}`.toUpperCase();
	if (e.statusCode === 'delivered') return 'delivered';
	if (e.statusCode === 'failure') return 'exception';
	if (/OUT FOR DELIVERY|WITH DELIVERY COURIER/.test(text)) return 'out';
	if (/READY FOR PICK|AVAILABLE FOR PICK|AT (THE )?(SERVICE POINT|PARCEL LOCKER)/.test(text)) return 'pickup';
	if (e.statusCode === 'pre-transit') return 'info';
	if (e.statusCode === 'transit') return 'transit';
	return 'unknown';
}

const capitalize = (s: string) => (s === s.toUpperCase() ? s.charAt(0) + s.slice(1).toLowerCase() : s);

export async function trackDhl(code: string): Promise<PackageTracking> {
	if (!config.dhlApiKey) throw new NotConfiguredError('DHL API key not set');
	const url = new URL('https://api-eu.dhl.com/track/shipments');
	url.searchParams.set('trackingNumber', code);
	url.searchParams.set('language', 'en');
	const response = await fetch(url, { headers: { 'DHL-API-Key': config.dhlApiKey }, signal: AbortSignal.timeout(15_000) });
	if (response.status === 404) throw new NotFoundError();
	if (!response.ok) throw new Error(`DHL: HTTP ${response.status}`);
	const body = (await response.json()) as {
		shipments?: { status?: DhlEvent; events?: DhlEvent[]; estimatedTimeOfDelivery?: string }[];
	};
	const shipment = body.shipments?.[0];
	if (!shipment) throw new NotFoundError();

	const events: PackageEvent[] = (shipment.events ?? []).map((e) => ({
		time: e.timestamp ?? null,
		description: capitalize(e.description || e.status || 'Event'),
		location: e.location?.address?.addressLocality ?? null
	}));
	const latest = shipment.status ?? shipment.events?.[0];
	const state = stateOf(latest);
	return {
		state,
		summary: latest ? capitalize(latest.description || latest.status || '') || null : null,
		events,
		eta: state === 'delivered' ? null : (shipment.estimatedTimeOfDelivery ?? null),
		pickup: null
	};
}
