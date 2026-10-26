import { error, json } from '@sveltejs/kit';
import { surveyImage } from '$lib/server/survey';
import { canonicalView } from '$lib/survey';
import type { RequestHandler } from './$types';

/** A number in the plain form the page writes (no exponent, hex or Infinity). */
const NUMBER = /^-?\d{1,4}(?:\.\d{1,6})?$/;

/** B3: a DSS2 colour cutout, `?ra=&dec=&fov=&w=&h=` (degrees, px), rounded to the cached grid; cached for good. */
export const GET: RequestHandler = async ({ url }) => {
	const values = ['ra', 'dec', 'fov', 'w', 'h'].map((k) => url.searchParams.get(k) ?? '');
	if (!values.every((v) => NUMBER.test(v))) error(400, 'ra, dec, fov, w and h are needed as numbers');
	const [ra, dec, fov, w, h] = values.map(Number);
	const view = canonicalView({ ra, dec, fov, w, h });
	if (!view) error(400, 'Out of range: RA 0–360°, Dec ±90°, fov 0.1–20°, 64–1600 px');
	try {
		const body = await surveyImage(view);
		return new Response(body, { headers: { 'content-type': 'image/jpeg', 'content-length': String(body.byteLength), 'cache-control': 'private, max-age=31536000, immutable' } });
	} catch (e) {
		return json({ message: `Survey unavailable: ${(e as Error).message}` }, { status: 502, headers: { 'cache-control': 'no-store' } });
	}
};
