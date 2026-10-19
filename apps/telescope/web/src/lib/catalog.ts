// The planner's DSO catalog: OpenNGC (CC BY-SA 4.0, Mattia Verga) reduced to imaging targets, and the
// Sharpless catalogue's positions from Wikidata (CC0), built by scripts/catalog.mjs (see the JSON's
// `sources`). Bundled: works without the internet.
import data from './catalog/dso.json';

export type DsoGroup = 'galaxy' | 'nebula' | 'planetary' | 'cluster' | 'globular' | 'dark';

export interface Dso {
	/** Display id and goal key: "M 31", "NGC 7000", "IC 1805", "C 9", "Sh2-129". */
	id: string;
	/** Other designations: "NGC 224", "C 20", "Sh2-155", "LBN 373". */
	aliases: string[];
	/** Common names: "Andromeda Galaxy". */
	names: string[];
	/** OpenNGC type code (G, HII, PN, OCl …). */
	type: string;
	group: DsoGroup;
	/** J2000, degrees. */
	ra: number;
	dec: number;
	/** Major and minor axis, arcmin (none for the Sharpless objects from Wikidata). */
	maj: number | null;
	min: number | null;
	mag: number | null;
	/** IAU abbreviation; "" when unknown (Sharpless objects from Wikidata). */
	con: string;
}

/** Where the catalog comes from, for the credit line. */
export const CATALOG_SOURCES: { name: string; url: string; license: string; licenseUrl: string; attribution: string }[] = data.sources;

type Row = [string, string[], string[], string, DsoGroup, number, number, number | null, number | null, number | null, number | null, string];

export const catalog: Dso[] = (data.objects as unknown as Row[]).map(([id, aliases, names, type, group, ra, dec, maj, min, , mag, con]) => ({ id, aliases, names, type, group, ra, dec, maj, min, mag, con }));

export const GROUP_LABELS: Record<DsoGroup, string> = {
	nebula: 'Nebula',
	galaxy: 'Galaxy',
	cluster: 'Open cluster',
	globular: 'Globular',
	planetary: 'Planetary',
	dark: 'Dark nebula'
};

const TYPE_LABELS: Record<string, string> = {
	G: 'Galaxy',
	GPair: 'Galaxy pair',
	GTrpl: 'Galaxy triplet',
	GGroup: 'Galaxy group',
	OCl: 'Open cluster',
	GCl: 'Globular cluster',
	'Cl+N': 'Cluster with nebula',
	HII: 'Emission nebula',
	EmN: 'Emission nebula',
	Neb: 'Nebula',
	RfN: 'Reflection nebula',
	SNR: 'Supernova remnant',
	DrkN: 'Dark nebula',
	PN: 'Planetary nebula'
};
export const typeLabel = (type: string) => TYPE_LABELS[type] ?? type;

/** "NGC0224", "ngc 224", "M31", "Messier 31", "SH 2-155", "Sh2 155" -> one form for comparing. */
export function normalizeId(name: string): string {
	return name
		.toLowerCase()
		.replace(/^messier\s*/, 'm')
		.replace(/^caldwell\s*/, 'c')
		.replace(/^sh\s*2\s*[-\s]?\s*/, 'sh2-')
		.replace(/\s+/g, '')
		.replace(/^([a-z]+)0+(\d)/, '$1$2');
}

const index = new Map<string, Dso>();
for (const o of catalog) for (const id of [o.id, ...o.aliases]) if (!index.has(normalizeId(id))) index.set(normalizeId(id), o);
const byName = new Map<string, Dso>();
for (const o of catalog) for (const n of o.names) byName.set(n.toLowerCase(), o);

/**
 * The catalog object an ASIAIR target name means: a designation ("NGC 7000", "M31", "Sh2-155"), the
 * designation at the start ("NGC 7000 North America"), or a common name ("Pleiades"). Null when none.
 */
export function findDso(name: string): Dso | null {
	const text = name.trim();
	if (!text) return null;
	const exact = index.get(normalizeId(text)) ?? byName.get(text.toLowerCase());
	if (exact) return exact;
	const lead = /^(sh\s*2\s*[-\s]?\s*\d+|[a-z]+\s*\d+)/i.exec(text);
	return lead ? (index.get(normalizeId(lead[1])) ?? null) : null;
}

/** Search by designation, alias or common name: exact designation first, then prefix, then substring. */
export function searchCatalog(query: string): Dso[] {
	const q = query.trim().toLowerCase();
	if (!q) return catalog;
	const n = normalizeId(q);
	const scored: [number, Dso][] = [];
	for (const o of catalog) {
		const ids = [o.id, ...o.aliases].map(normalizeId);
		let score = 0;
		if (ids.includes(n)) score = 4;
		else if (ids.some((id) => id.startsWith(n))) score = 3;
		else if (o.names.some((x) => x.toLowerCase().includes(q))) score = 2;
		else if (typeLabel(o.type).toLowerCase().includes(q) || o.con.toLowerCase() === q) score = 1;
		if (score) scored.push([score, o]);
	}
	return scored.sort((a, b) => b[0] - a[0]).map(([, o]) => o);
}

/** Angular distance, degrees. */
export function separation(ra1: number, dec1: number, ra2: number, dec2: number): number {
	const r = Math.PI / 180;
	const c = Math.sin(dec1 * r) * Math.sin(dec2 * r) + Math.cos(dec1 * r) * Math.cos(dec2 * r) * Math.cos((ra1 - ra2) * r);
	return Math.acos(Math.max(-1, Math.min(1, c))) / r;
}

/** The camera's field: ASI533 (11.3 mm × 11.3 mm) at 670 mm, 0.966° on each side. */
export const FIELD_ARCMIN = (2 * Math.atan(11.31 / 2 / 670) * 180 * 60) / Math.PI;

/** How the object sits in the field: "fits", "fills the field", "small", or a mosaic ("2×2 mosaic"); 15 % panel overlap. */
export function framing(o: Pick<Dso, 'maj' | 'min'>): { label: string; kind: 'small' | 'fits' | 'fills' | 'mosaic' | 'unknown' } {
	if (o.maj === null) return { label: 'size unknown', kind: 'unknown' };
	const major = o.maj;
	const minor = o.min ?? o.maj;
	if (major <= FIELD_ARCMIN / 8) return { label: 'small in the field', kind: 'small' };
	if (major <= FIELD_ARCMIN * 0.8) return { label: 'fits', kind: 'fits' };
	if (major <= FIELD_ARCMIN * 1.05 && minor <= FIELD_ARCMIN) return { label: 'fills the field', kind: 'fills' };
	const panel = FIELD_ARCMIN * 0.85;
	const a = Math.ceil(major / panel);
	const b = Math.max(1, Math.ceil(minor / panel));
	return { label: `${a}×${b} mosaic`, kind: 'mosaic' };
}

const GROUP_APPEAL: Record<DsoGroup, number> = { nebula: 1, galaxy: 1, planetary: 0.9, dark: 0.9, globular: 0.85, cluster: 0.7 };

/**
 * How worthwhile the object is as a target for this camera, 0.25…1.1, a rough taste: large enough to show
 * detail in the field (15′ and up count fully), nebulae and galaxies over clusters, a common name a little.
 * Multiplies the planner's score in the best-first list.
 */
export function appeal(o: Dso): number {
	// No size: the Sharpless objects from Wikidata, mostly large HII regions.
	const size = o.maj === null ? 0.8 : Math.min(1, Math.max(0.35, o.maj / 15));
	return size * GROUP_APPEAL[o.group] * (o.names.length ? 1.1 : 1);
}

/** Arcmin -> "12′", "2.1°". */
export const formatSize = (arcmin: number | null) => (arcmin === null ? '–' : arcmin >= 60 ? `${(arcmin / 60).toFixed(1)}°` : `${arcmin >= 10 ? Math.round(arcmin) : arcmin.toFixed(1)}′`);
