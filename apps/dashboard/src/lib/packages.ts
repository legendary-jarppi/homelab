// Shared by the card and the server: carrier detection from the code's format, display names.
import type { Carrier, PackageState, TrackedPackage } from '$lib/types';

export const CARRIERS: { id: Carrier; name: string }[] = [
	{ id: 'posti', name: 'Posti' },
	{ id: 'dhl', name: 'DHL' },
	{ id: 'ups', name: 'UPS' }
];

export const carrierName = (carrier: Carrier): string => CARRIERS.find((c) => c.id === carrier)?.name ?? carrier;

export const TRACKING_URL: Record<Carrier, (code: string) => string> = {
	posti: (c) => `https://www.posti.fi/fi/seuranta#/lahetys/${c}`,
	dhl: (c) => `https://www.dhl.com/fi-fi/home/tracking.html?tracking-id=${c}`,
	ups: (c) => `https://www.ups.com/track?tracknum=${c}`
};

/**
 * Carriers whose status the dashboard cannot read: DHL gives API access to business customers only
 * and blocks automated use of its website. Their packages link to the carrier's tracking page.
 */
export const LINK_ONLY: ReadonlySet<Carrier> = new Set(['dhl']);
/** Nothing reports a link-only package as delivered, so it leaves the card this long after being added. */
const LINK_ONLY_KEEP_MS = 14 * 86_400_000;

/** When a link-only package leaves the card (unix ms). */
export const linkOnlyUntil = (p: TrackedPackage): number => p.addedAt + LINK_ONLY_KEEP_MS;

/** Upper case, no spaces or dashes: codes are often copied with grouping. */
export function normalizeCode(code: string): string {
	return code.toUpperCase().replace(/[\s-]+/g, '');
}

/**
 * Best guess from the code's format; null when ambiguous (the user picks).
 * UPS: 1Z + 16. Posti: JJFI…, and international mail (two letters, nine digits, two letters),
 * which Posti delivers in Finland. DHL: Express (10 digits), JJD/JVGL/GM… eCommerce and Parcel.
 */
export function detectCarrier(raw: string): Carrier | null {
	const code = normalizeCode(raw);
	if (/^1Z[0-9A-Z]{16}$/.test(code)) return 'ups';
	if (/^JJFI\d{10,}$/.test(code) || /^[A-Z]{2}\d{9}[A-Z]{2}$/.test(code)) return 'posti';
	if (/^\d{10}$/.test(code) || /^(JJD|JVGL|GM|LX|RX|CN)\w{8,}$/.test(code) || /^00340\d{15}$/.test(code)) return 'dhl';
	return null;
}

export const STATE_LABEL: Record<PackageState, string> = {
	unknown: 'No tracking info yet',
	info: 'Waiting for the carrier',
	transit: 'On the way',
	out: 'Out for delivery',
	pickup: 'Ready for pickup',
	delivered: 'Delivered',
	exception: 'Problem with delivery'
};
