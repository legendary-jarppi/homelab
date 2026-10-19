// B2: the image's plate solve, evaluated in the browser. FITS WCS, gnomonic (TAN) with optional SIP
// distortion (Calabretta & Greisen 2002; Shupe et al. 2005), CD matrix. The header describes the data array
// with 1-based pixel coordinates; the displayed image shows data row 1 at the top (`rowsTopDown`), so display
// pixel coordinates (pixel centres at integers, from the top-left pixel) are x_fits − 1, y_fits − 1.
import { separation } from './catalog';
import { formatDec, formatRa } from './format';
import type { WcsHeader } from './types';

const RAD = Math.PI / 180;

type Poly = [p: number, q: number, coefficient: number][];

/** SIP polynomial terms `<prefix>_p_q` of a header (Siril writes order 0 with only a zero A_0_0: no terms). */
function sipTerms(header: WcsHeader, prefix: 'A' | 'B' | 'AP' | 'BP'): Poly {
	const order = Number(header[`${prefix}_ORDER`]);
	if (!Number.isFinite(order) || order < 0) return [];
	const terms: Poly = [];
	for (let p = 0; p <= order; p++)
		for (let q = 0; q + p <= order; q++) {
			const c = Number(header[`${prefix}_${p}_${q}`]);
			if (c && Number.isFinite(c)) terms.push([p, q, c]);
		}
	return terms;
}

function poly(terms: Poly, u: number, v: number): number {
	let sum = 0;
	for (const [p, q, c] of terms) sum += c * u ** p * v ** q;
	return sum;
}

/** Gnomonic projection of (ra, dec) about (ra0, dec0), degrees in and out; null on the far hemisphere. */
export function tanProject(ra: number, dec: number, ra0: number, dec0: number): [xi: number, eta: number] | null {
	const d = dec * RAD;
	const d0 = dec0 * RAD;
	const da = (ra - ra0) * RAD;
	const cosC = Math.sin(d0) * Math.sin(d) + Math.cos(d0) * Math.cos(d) * Math.cos(da);
	if (cosC <= 1e-6) return null;
	return [(Math.cos(d) * Math.sin(da)) / cosC / RAD, (Math.cos(d0) * Math.sin(d) - Math.sin(d0) * Math.cos(d) * Math.cos(da)) / cosC / RAD];
}

/** Inverse gnomonic projection: tangent-plane offsets (degrees, ξ towards east) about (ra0, dec0) to (ra, dec). */
export function tanDeproject(xi: number, eta: number, ra0: number, dec0: number): [ra: number, dec: number] {
	const x = xi * RAD;
	const y = eta * RAD;
	const d0 = dec0 * RAD;
	const rho = Math.hypot(x, y);
	if (rho === 0) return [ra0, dec0];
	const c = Math.atan(rho);
	const dec = Math.asin(Math.cos(c) * Math.sin(d0) + (y * Math.sin(c) * Math.cos(d0)) / rho);
	const ra = ra0 * RAD + Math.atan2(x * Math.sin(c), rho * Math.cos(d0) * Math.cos(c) - y * Math.sin(d0) * Math.sin(c));
	return [(((ra / RAD) % 360) + 360) % 360, dec / RAD];
}

export class Wcs {
	readonly ra0: number;
	readonly dec0: number;
	readonly crpix1: number;
	readonly crpix2: number;
	private readonly cd: [number, number, number, number];
	private readonly inv: [number, number, number, number];
	private readonly a: Poly;
	private readonly b: Poly;
	private readonly ap: Poly;
	private readonly bp: Poly;
	/** Arcseconds per pixel (geometric mean of the axes). */
	readonly scaleArcsec: number;

	private constructor(header: WcsHeader) {
		const n = (key: string) => Number(header[key]);
		this.ra0 = n('CRVAL1');
		this.dec0 = n('CRVAL2');
		this.crpix1 = n('CRPIX1');
		this.crpix2 = n('CRPIX2');
		this.cd = [n('CD1_1'), n('CD1_2'), n('CD2_1'), n('CD2_2')];
		const [a, b, c, d] = this.cd;
		const det = a * d - b * c;
		this.inv = [d / det, -b / det, -c / det, a / det];
		this.scaleArcsec = Math.sqrt(Math.abs(det)) * 3600;
		const sip = String(header.CTYPE1 ?? '').endsWith('-SIP') || header.A_ORDER !== undefined;
		this.a = sip ? sipTerms(header, 'A') : [];
		this.b = sip ? sipTerms(header, 'B') : [];
		this.ap = sip ? sipTerms(header, 'AP') : [];
		this.bp = sip ? sipTerms(header, 'BP') : [];
	}

	/** A TAN (or TAN-SIP) solution with a usable CD matrix, else null. */
	static from(header: WcsHeader | null | undefined): Wcs | null {
		if (!header) return null;
		const type1 = String(header.CTYPE1 ?? '');
		const type2 = String(header.CTYPE2 ?? '');
		if (!type1.startsWith('RA---TAN') || !type2.startsWith('DEC--TAN')) return null;
		const keys = ['CRVAL1', 'CRVAL2', 'CRPIX1', 'CRPIX2', 'CD1_1', 'CD1_2', 'CD2_1', 'CD2_2'];
		if (!keys.every((k) => Number.isFinite(Number(header[k])))) return null;
		const wcs = new Wcs(header);
		return Number.isFinite(wcs.inv[0]) && wcs.scaleArcsec > 0 ? wcs : null;
	}

	/** Display pixel (centres at integers, top-left pixel 0, 0) to (ra, dec) degrees. */
	pixelToWorld(x: number, y: number): [ra: number, dec: number] {
		const u = x + 1 - this.crpix1;
		const v = y + 1 - this.crpix2;
		const uu = u + poly(this.a, u, v);
		const vv = v + poly(this.b, u, v);
		const [a, b, c, d] = this.cd;
		return tanDeproject(a * uu + b * vv, c * uu + d * vv, this.ra0, this.dec0);
	}

	/** (ra, dec) degrees to a display pixel; null on the far side of the sky. */
	worldToPixel(ra: number, dec: number): [x: number, y: number] | null {
		const t = tanProject(ra, dec, this.ra0, this.dec0);
		if (!t) return null;
		const [a, b, c, d] = this.inv;
		const uu = a * t[0] + b * t[1];
		const vv = c * t[0] + d * t[1];
		let u = uu;
		let v = vv;
		if (this.a.length || this.b.length) {
			// The inverse polynomial (AP, BP) when given as the start, then refined: u + A(u, v) = uu.
			if (this.ap.length || this.bp.length) {
				u = uu + poly(this.ap, uu, vv);
				v = vv + poly(this.bp, uu, vv);
			}
			for (let i = 0; i < 30; i++) {
				const du = uu - (u + poly(this.a, u, v));
				const dv = vv - (v + poly(this.b, u, v));
				u += du;
				v += dv;
				if (Math.abs(du) < 1e-6 && Math.abs(dv) < 1e-6) break;
			}
		}
		return [u + this.crpix1 - 1, v + this.crpix2 - 1];
	}
}

/** The sky an image covers: its centre and the radius reaching every corner, degrees. */
export function fieldOf(wcs: Wcs, width: number, height: number): { ra: number; dec: number; radius: number } {
	const [ra, dec] = wcs.pixelToWorld((width - 1) / 2, (height - 1) / 2);
	const corners: [number, number][] = [
		[-0.5, -0.5],
		[width - 0.5, -0.5],
		[-0.5, height - 0.5],
		[width - 0.5, height - 0.5]
	];
	const radius = Math.max(...corners.map(([x, y]) => separation(ra, dec, ...wcs.pixelToWorld(x, y))));
	return { ra, dec, radius };
}

/**
 * Outline of an object of `majArcmin` × `minArcmin` at position angle `paDeg` (from north through east) on
 * the sky, as display pixels: sampled on the sky and projected, so mirroring, rotation and distortion all
 * come out right. Null when a point falls off the projection.
 */
export function ellipseOutline(wcs: Wcs, ra: number, dec: number, majArcmin: number, minArcmin: number, paDeg: number, points = 48): [number, number][] | null {
	const a = majArcmin / 120;
	const b = minArcmin / 120;
	const pa = paDeg * RAD;
	const out: [number, number][] = [];
	for (let i = 0; i < points; i++) {
		const t = (2 * Math.PI * i) / points;
		// Offsets east (ξ) and north (η): major axis along the position angle, minor across it.
		const xi = a * Math.cos(t) * Math.sin(pa) + b * Math.sin(t) * Math.cos(pa);
		const eta = a * Math.cos(t) * Math.cos(pa) - b * Math.sin(t) * Math.sin(pa);
		const p = wcs.worldToPixel(...tanDeproject(xi, eta, ra, dec));
		if (!p) return null;
		out.push(p);
	}
	return out;
}

/** Grid spacings, degrees: declination in arcminutes and degrees, right ascension in time (1 min = 0.25°). */
const DEC_STEPS = [1, 2, 5, 10, 15, 20, 30, 60, 120, 300, 600].map((m) => m / 60);
const RA_STEPS = [4, 8, 20, 40, 60, 120, 300, 600, 1200, 1800, 3600, 7200].map((s) => s / 240);

export interface GridLine {
	/** Constant declination (`dec`) or right ascension (`ra`), and its value in degrees. */
	axis: 'ra' | 'dec';
	value: number;
	label: string;
	points: [number, number][];
}

/**
 * RA/Dec grid lines over a region of the image (display pixels, e.g. the part on screen), about `lines`
 * of each across it, as polylines sampled every few pixels of the region.
 */
export function gridLines(wcs: Wcs, region: { x0: number; y0: number; x1: number; y1: number }, lines = 4): GridLine[] {
	const { x0, y0, x1, y1 } = region;
	const [cra, cdec] = wcs.pixelToWorld((x0 + x1) / 2, (y0 + y1) / 2);
	// The region's extent on the sky from its border, RA unwrapped about the centre.
	let raMin = Infinity;
	let raMax = -Infinity;
	let decMin = Infinity;
	let decMax = -Infinity;
	const n = 16;
	for (let i = 0; i <= n; i++)
		for (const [x, y] of [
			[x0 + ((x1 - x0) * i) / n, y0],
			[x0 + ((x1 - x0) * i) / n, y1],
			[x0, y0 + ((y1 - y0) * i) / n],
			[x1, y0 + ((y1 - y0) * i) / n]
		]) {
			const [ra, dec] = wcs.pixelToWorld(x, y);
			const dra = ((ra - cra + 540) % 360) - 180;
			raMin = Math.min(raMin, dra);
			raMax = Math.max(raMax, dra);
			decMin = Math.min(decMin, dec);
			decMax = Math.max(decMax, dec);
		}
	// A pole inside: every right ascension, declination up to the pole.
	const pole = [90, -90].find((d) => {
		const p = wcs.worldToPixel(0, d);
		return p && p[0] >= x0 && p[0] <= x1 && p[1] >= y0 && p[1] <= y1;
	});
	if (pole !== undefined) {
		raMin = -180;
		raMax = 180;
		if (pole > 0) decMax = 90;
		else decMin = -90;
	}
	const decStep = DEC_STEPS.find((s) => (decMax - decMin) / s <= lines) ?? DEC_STEPS.at(-1)!;
	const raStep = RA_STEPS.find((s) => (raMax - raMin) / s <= lines) ?? RA_STEPS.at(-1)!;
	const out: GridLine[] = [];
	const samples = 40;
	const inside = (p: [number, number] | null): p is [number, number] => p !== null && p[0] >= x0 - (x1 - x0) && p[0] <= x1 + (x1 - x0) && p[1] >= y0 - (y1 - y0) && p[1] <= y1 + (y1 - y0);
	for (let dec = Math.ceil(decMin / decStep) * decStep; dec <= decMax; dec += decStep) {
		const points: [number, number][] = [];
		for (let i = 0; i <= samples; i++) {
			const p = wcs.worldToPixel(cra + raMin + ((raMax - raMin) * i) / samples, dec);
			if (inside(p)) points.push(p);
		}
		if (points.length > 1) out.push({ axis: 'dec', value: dec, label: formatDec(dec), points });
	}
	for (let dra = Math.ceil((cra + raMin) / raStep) * raStep - cra; dra <= raMax; dra += raStep) {
		const points: [number, number][] = [];
		for (let i = 0; i <= samples; i++) {
			const p = wcs.worldToPixel(cra + dra, decMin + ((decMax - decMin) * i) / samples);
			if (inside(p)) points.push(p);
		}
		if (points.length > 1) out.push({ axis: 'ra', value: cra + dra, label: formatRa(cra + dra, raStep < 0.25), points });
	}
	return out;
}
