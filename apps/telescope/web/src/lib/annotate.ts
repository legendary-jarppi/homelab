// B2: what to draw on an image from its plate solve: the catalog's objects (outlines from size and position
// angle) and the named or designated bright stars, in display pixels.
import { catalog, separation, type DsoGroup } from './catalog';
import { ellipseOutline, fieldOf, type Wcs } from './wcs';

export interface ObjectMark {
	id: string;
	/** "M 45 Pleiades". */
	label: string;
	group: DsoGroup;
	x: number;
	y: number;
	/** Outline (display pixels); null for objects without a size (drawn as a marker). */
	outline: [number, number][] | null;
	/** Size, arcmin, to order big ones first. */
	maj: number;
}

export interface StarMark {
	/** IAU name, else the Bayer or Flamsteed designation. */
	label: string;
	/** The designation under a proper name ("η Tau"), else null. */
	designation: string | null;
	mag: number;
	x: number;
	y: number;
}

/** Points of an object or star this far outside the image (in image sizes) are still kept: their outline may reach in. */
const inImage = (x: number, y: number, width: number, height: number, margin: number) => x >= -margin && y >= -margin && x <= width - 1 + margin && y <= height - 1 + margin;

/** Catalog objects on the image (their outline or centre inside), the largest first. */
export function objectsOn(wcs: Wcs, width: number, height: number): ObjectMark[] {
	const field = fieldOf(wcs, width, height);
	const out: ObjectMark[] = [];
	for (const o of catalog) {
		const size = o.maj ?? 0;
		if (separation(field.ra, field.dec, o.ra, o.dec) > field.radius + size / 120) continue;
		const centre = wcs.worldToPixel(o.ra, o.dec);
		if (!centre) continue;
		const outline = o.maj ? ellipseOutline(wcs, o.ra, o.dec, o.maj, o.min ?? o.maj, o.pa ?? 0) : null;
		const reaches = outline ? outline.some(([x, y]) => inImage(x, y, width, height, 0)) || inImage(centre[0], centre[1], width, height, 0) : inImage(centre[0], centre[1], width, height, 0);
		if (!reaches) continue;
		out.push({ id: o.id, label: o.names[0] ? `${o.id} ${o.names[0]}` : o.id, group: o.group, x: centre[0], y: centre[1], outline, maj: size });
	}
	return out.sort((a, b) => b.maj - a.maj);
}

type StarRow = [string | null, string | null, number, number, number];

let stars: Promise<StarRow[]> | null = null;

/** Bright stars on the image, brightest first. The star list (~110 kB) loads on first use. */
export async function starsOn(wcs: Wcs, width: number, height: number): Promise<StarMark[]> {
	stars ??= import('./catalog/stars.json').then((m) => m.default.stars as StarRow[]);
	const field = fieldOf(wcs, width, height);
	const out: StarMark[] = [];
	for (const [name, designation, ra, dec, mag] of await stars) {
		if (Math.abs(dec - field.dec) > field.radius || separation(field.ra, field.dec, ra, dec) > field.radius) continue;
		const p = wcs.worldToPixel(ra, dec);
		if (!p || !inImage(p[0], p[1], width, height, 0)) continue;
		out.push({ label: name ?? designation ?? '', designation: name ? designation : null, mag, x: p[0], y: p[1] });
	}
	return out;
}
