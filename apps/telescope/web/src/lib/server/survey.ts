// B3: survey cutouts (DSS2 colour) from CDS hips2fits, kept in memory: least recently used out past
// CACHE_BYTES (~240 cutouts of ~100 kB; the pod has 256 Mi). One fetch at a time per cutout; a failure is
// remembered for a minute so a dead service is not hammered.
import type { SurveyView } from '$lib/survey';

const HIPS2FITS = 'https://alasky.cds.unistra.fr/hips-image-services/hips2fits';
const HIPS = 'CDS/P/DSS2/color';
/** A 1024 px cutout takes 3–4 s (measured). */
const TIMEOUT_MS = 20_000;
const CACHE_BYTES = 24 * 1024 * 1024;
/** Larger answers are refused (a 1600 px cutout is ~250 kB). */
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const FAILURE_MS = 60_000;

type Jpeg = Uint8Array<ArrayBuffer>;

const images = new Map<string, Jpeg>();
let cachedBytes = 0;
const pending = new Map<string, Promise<Jpeg>>();
const failures = new Map<string, { at: number; message: string }>();

async function load(v: SurveyView): Promise<Jpeg> {
	const url = new URL(HIPS2FITS);
	const params: Record<string, string> = { hips: HIPS, ra: String(v.ra), dec: String(v.dec), fov: String(v.fov), width: String(v.w), height: String(v.h), projection: 'TAN', coordsys: 'icrs', format: 'jpg' };
	for (const [k, value] of Object.entries(params)) url.searchParams.set(k, value);
	const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { accept: 'image/jpeg' } });
	if (!response.ok) throw new Error(`hips2fits: HTTP ${response.status}`);
	if (!response.headers.get('content-type')?.startsWith('image/jpeg')) throw new Error('hips2fits: not a JPEG');
	const body = new Uint8Array(await response.arrayBuffer());
	if (body.byteLength > MAX_IMAGE_BYTES) throw new Error('hips2fits: answer too large');
	return body;
}

/** The cutout's JPEG (a canonical view: lib/survey canonicalView), from memory or hips2fits. */
export async function surveyImage(v: SurveyView): Promise<Jpeg> {
	const key = `${v.ra}/${v.dec}/${v.fov}/${v.w}x${v.h}`;
	const hit = images.get(key);
	if (hit) {
		images.delete(key);
		images.set(key, hit);
		return hit;
	}
	const failed = failures.get(key);
	if (failed && Date.now() - failed.at < FAILURE_MS) throw new Error(failed.message);
	let request = pending.get(key);
	if (!request) {
		request = load(v)
			.then((body) => {
				failures.delete(key);
				images.set(key, body);
				cachedBytes += body.byteLength;
				for (const [oldKey, old] of images) {
					if (cachedBytes <= CACHE_BYTES) break;
					images.delete(oldKey);
					cachedBytes -= old.byteLength;
				}
				return body;
			})
			.catch((e: unknown) => {
				const message = e instanceof Error ? e.message : String(e);
				const now = Date.now();
				for (const [k, f] of failures) if (now - f.at >= FAILURE_MS) failures.delete(k);
				failures.set(key, { at: now, message });
				console.error(`survey ${key}: ${message}`);
				throw e;
			})
			.finally(() => pending.delete(key));
		pending.set(key, request);
	}
	return request;
}
