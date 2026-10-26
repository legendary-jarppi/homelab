// B3: framing on a survey image. The cutout is DSS2 colour from CDS hips2fits (TAN, ICRS, north up, east left,
// no rotation), fetched and cached by the server route /survey; the camera's field, mosaic panels, the
// object's outline and a session's plate-solved footprint are drawn over it in the browser.
import { FIELD_ARCMIN } from './catalog';
import { tanDeproject, tanProject } from './wcs';

/** Survey image side, px: sharp on a phone (DPR 3 at ~340 CSS px) and a laptop. */
export const SURVEY_SIZE = 1024;
/** Survey widths, degrees: the smallest that holds the view is used, so the same few repeat in the caches. */
export const SURVEY_FOVS = [2, 2.5, 3, 4, 5, 6, 8, 10, 12, 15];
/** Mosaic panels overlap by 15 % (as the planner's framing counts them). */
export const PANEL_OVERLAP = 0.15;
export const PANEL_STEP_ARCMIN = FIELD_ARCMIN * (1 - PANEL_OVERLAP);
/** Most mosaic panels along one side. */
export const MAX_PANELS = 6;

/** The credit the survey's terms ask for (hips2fits: CDS; DSS: STScI/NASA, the plates' copyright holders). */
export const SURVEY_CREDIT = {
	survey: 'DSS2 colour',
	surveyUrl: 'https://archive.stsci.edu/dss/copyright.html',
	text: 'Digitized Sky Survey, STScI/NASA (POSS-II: Caltech/Palomar; UK Schmidt: UK SERC/PPARC and AAO); colour HiPS by CDS',
	service: 'hips2fits',
	serviceUrl: 'https://alasky.cds.unistra.fr/hips-image-services/hips2fits',
	serviceText: 'a service provided by CDS, Strasbourg'
};

/** One survey cutout: centre (degrees), width of the larger side (degrees), size in px. */
export interface SurveyView {
	ra: number;
	dec: number;
	fov: number;
	w: number;
	h: number;
}

const round = (value: number, step: number) => Math.round(value / step) * step;

/**
 * The cutout as the server fetches and caches it: RA and Dec to 0.001° (3.6″), the width to 0.01°, the
 * size to 32 px; null outside RA 0–360°, Dec ±90°, width 0.1–20°, 64–1600 px. The page asks for exactly
 * these values so the image matches the drawing over it.
 */
export function canonicalView(v: SurveyView): SurveyView | null {
	if (![v.ra, v.dec, v.fov, v.w, v.h].every(Number.isFinite)) return null;
	if (v.ra < 0 || v.ra > 360 || Math.abs(v.dec) > 90 || v.fov < 0.1 || v.fov > 20) return null;
	const w = round(v.w, 32);
	const h = round(v.h, 32);
	if (w < 64 || h < 64 || w > 1600 || h > 1600) return null;
	const ra = round(v.ra, 0.001) % 360;
	return { ra: Number(ra.toFixed(3)), dec: Number(round(v.dec, 0.001).toFixed(3)), fov: Number(round(v.fov, 0.01).toFixed(2)), w, h };
}

export const surveyUrl = (v: SurveyView) => `/survey?ra=${v.ra}&dec=${v.dec}&fov=${v.fov}&w=${v.w}&h=${v.h}`;

/** The smallest survey width, degrees, holding `needDeg` (the widest when nothing does). */
export const surveyFov = (needDeg: number) => SURVEY_FOVS.find((f) => f >= needDeg) ?? SURVEY_FOVS[SURVEY_FOVS.length - 1];

/** A square cutout of `fov` degrees around (ra, dec), canonical. */
export function squareView(ra: number, dec: number, fov: number, size = SURVEY_SIZE): SurveyView {
	return canonicalView({ ra: ((ra % 360) + 360) % 360, dec: Math.max(-90, Math.min(90, dec)), fov, w: size, h: size })!;
}

/**
 * Sky to the cutout's pixels (0, 0 the top-left corner, w, h the bottom-right). hips2fits puts the reference
 * pixel at FITS (w/2, h/2), counts FITS rows from the bottom and writes the JPEG north up: -ξ to the right, η up.
 */
export function toSurvey(v: SurveyView, ra: number, dec: number): [x: number, y: number] | null {
	const t = tanProject(ra, dec, v.ra, v.dec);
	if (!t) return null;
	const s = v.fov / Math.max(v.w, v.h);
	return [v.w / 2 - 0.5 - t[0] / s, v.h / 2 + 0.5 - t[1] / s];
}

/** The cutout's pixels to the sky. */
export function fromSurvey(v: SurveyView, x: number, y: number): [ra: number, dec: number] {
	const s = v.fov / Math.max(v.w, v.h);
	return tanDeproject(-(x - v.w / 2 + 0.5) * s, -(y - v.h / 2 - 0.5) * s, v.ra, v.dec);
}

/**
 * The camera's field on the sky at the ASIAIR's camera angle (FITS ROTATOR, degrees): the image's top edge
 * points at position angle -angle (from north through west; measured on the plate solves of the ASIAIR's
 * frames: ROTATOR 30 has the top 29.7° west of north, ROTATOR 93 and 273 have it 93° and 273° west of north).
 * The image is not mirrored, so its right edge is 90° on, clockwise on a north-up, east-left sky.
 * `offset` moves the field (a mosaic panel) along the image's right and top edges, arcmin; corners
 * clockwise from the top-left, (ra, dec) degrees, on the tangent plane at (ra, dec).
 */
export function fieldCorners(ra: number, dec: number, angleDeg: number, offset: [right: number, up: number] = [0, 0], sideArcmin = FIELD_ARCMIN): [number, number][] {
	const a = (angleDeg * Math.PI) / 180;
	// Unit vectors in (ξ east, η north).
	const up: [number, number] = [-Math.sin(a), Math.cos(a)];
	const right: [number, number] = [-Math.cos(a), -Math.sin(a)];
	const half = sideArcmin / 2;
	const corner = (u: number, v: number) => {
		const du = (offset[0] + u) / 60;
		const dv = (offset[1] + v) / 60;
		return tanDeproject(du * right[0] + dv * up[0], du * right[1] + dv * up[1], ra, dec);
	};
	return [corner(-half, half), corner(half, half), corner(half, -half), corner(-half, -half)];
}

/** Panel offsets (right, up), arcmin, of a `cols` × `rows` mosaic centred on the target. */
export function panelOffsets(cols: number, rows: number): [number, number][] {
	const out: [number, number][] = [];
	for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) out.push([(c - (cols - 1) / 2) * PANEL_STEP_ARCMIN, ((rows - 1) / 2 - r) * PANEL_STEP_ARCMIN]);
	return out;
}

/** The mosaic's extent, arcmin, along one side. */
export const mosaicSpan = (panels: number) => (panels - 1) * PANEL_STEP_ARCMIN + FIELD_ARCMIN;
