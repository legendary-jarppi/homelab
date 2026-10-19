#!/usr/bin/env node
// Builds src/lib/catalog/dso.json, the planner's DSO catalog:
// - OpenNGC, a pinned release (https://github.com/mattiaverga/OpenNGC, CC-BY-SA-4.0, Mattia Verga),
//   checked against the checksums below;
// - the Sharpless catalogue's positions from Wikidata (CC0; a live query, so the snapshot date is recorded:
//   Wikidata has no releases to pin). Sizes are not in Wikidata, so Sharpless objects have none.
// Run by hand when moving to a new release: update RELEASE and the checksums, then
// `node scripts/catalog.mjs` and commit the JSON.
//
// Changes made to OpenNGC's data (the licence asks for them to be indicated): only objects worth imaging
// from the cabin are kept (north of −35°; nebulae, clusters and planetary nebulae; galaxies brighter than
// GALAXY_MAG or with a Messier number or a common name); single stars, asterisms, duplicates and
// non-existent objects are dropped (a duplicate's name becomes an alias of the object it duplicates);
// coordinates are converted to degrees and the columns reduced to the ones below.
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';

const RELEASE = 'v20260501';
const FILES = {
	'NGC.csv': '840fe0c9ee1332e551b2e722a0e92726cd7b157914a3d2177602832aadd3aa9e',
	'addendum.csv': '1d8f0914e643ada325a5a94d88d8fefad6a4937a2f77cc34f21483af22b11983'
};
const OUT = new URL('../src/lib/catalog/dso.json', import.meta.url);
const WIKIDATA = 'https://query.wikidata.org/sparql';
/** Items with a catalogue code qualified "Sharpless catalogue" (Q66381095), with position and English label. */
const SHARPLESS_QUERY = `SELECT ?item ?code ?ra ?dec ?label WHERE {
  ?st pq:P972 wd:Q66381095 ; ps:P528 ?code .
  ?item p:P528 ?st ; wdt:P6257 ?ra ; wdt:P6258 ?dec .
  OPTIONAL { ?item rdfs:label ?label FILTER(LANG(?label) = "en") }
}`;
const MIN_DEC = -35;
const GALAXY_MAG = 12;
const DROP = new Set(['*', '**', '*Ass', 'Dup', 'NonEx', 'Nova', 'Other']);

/** Type codes (NGC_guide.txt) -> the planner's groups. */
const GROUP = {
	G: 'galaxy', GPair: 'galaxy', GTrpl: 'galaxy', GGroup: 'galaxy',
	OCl: 'cluster', GCl: 'globular', 'Cl+N': 'nebula',
	HII: 'nebula', EmN: 'nebula', Neb: 'nebula', RfN: 'nebula', SNR: 'nebula', DrkN: 'dark',
	PN: 'planetary'
};

const sha256 = (text) => createHash('sha256').update(text).digest('hex');

async function fetchCsv(name) {
	const url = `https://raw.githubusercontent.com/mattiaverga/OpenNGC/${RELEASE}/database_files/${name}`;
	const response = await fetch(url);
	if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
	const text = await response.text();
	const sum = sha256(text);
	if (FILES[name] !== sum) throw new Error(`${name}: sha256 ${sum}, expected ${FILES[name] || '(not set)'}`);
	const [head, ...lines] = text.trim().split(/\r?\n/);
	const cols = head.split(';');
	return lines.map((line) => Object.fromEntries(line.split(';').map((v, i) => [cols[i], v.trim()])));
}

/** "NGC0224" -> "NGC 224", "IC0434" -> "IC 434", "C009" -> "C 9", "Mel022" -> "Mel 22", "B033" -> "B 33". */
function designation(name) {
	const m = /^([A-Za-z]+)0*(\d+)(.*)$/.exec(name);
	return m ? `${m[1]} ${m[2]}${m[3]}` : name;
}

function sexagesimal(text, hours) {
	if (!text) return null;
	const sign = text.startsWith('-') ? -1 : 1;
	const [a, b, c] = text.replace(/^[+-]/, '').split(':').map(Number);
	return Math.round(sign * (a + b / 60 + c / 3600) * (hours ? 15 : 1) * 1e4) / 1e4;
}

const num = (v) => (v === '' || v === undefined ? null : Number(v));

/** Aliases from the identifier list that observers type: Caldwell, Sharpless, LBN, LDN, Melotte, Collinder, vdB. */
function aliases(identifiers) {
	const out = [];
	for (const raw of identifiers.split(',')) {
		const id = raw.trim();
		let m;
		if ((m = /^C 0*(\d+)$/.exec(id))) out.push(`C ${m[1]}`);
		else if ((m = /^SH 2-0*(\d+)$/.exec(id))) out.push(`Sh2-${m[1]}`);
		else if ((m = /^(LBN|LDN|Mel|Cr|vdB|Ced) 0*(\d+)$/.exec(id))) out.push(`${m[1]} ${m[2]}`);
	}
	return out;
}

const rows = [...(await fetchCsv('NGC.csv')), ...(await fetchCsv('addendum.csv'))];
const objects = new Map();
for (const r of rows) {
	if (DROP.has(r.Type) || !GROUP[r.Type]) continue;
	const dec = sexagesimal(r.Dec, false);
	const ra = sexagesimal(r.RA, true);
	if (ra === null || dec === null || dec < MIN_DEC) continue;
	const mag = num(r['V-Mag']) ?? num(r['B-Mag']);
	const names = r['Common names'] ? r['Common names'].split(',').map((s) => s.trim()).filter(Boolean) : [];
	const messier = r.M ? `M ${Number(r.M)}` : null;
	if (GROUP[r.Type] === 'galaxy' && !messier && !names.length && !(mag !== null && mag <= GALAXY_MAG)) continue;
	const own = designation(r.Name);
	const ids = [own, ...(r.NGC ? r.NGC.split(',').map((n) => `NGC ${Number(n)}`) : []), ...(r.IC ? r.IC.split(',').map((n) => `IC ${Number(n)}`) : []), ...aliases(r.Identifiers)];
	const all = [...new Set(messier ? [messier, ...ids] : ids)];
	objects.set(own, {
		id: all[0],
		aliases: all.slice(1),
		names,
		type: r.Type,
		group: GROUP[r.Type],
		ra,
		dec,
		maj: num(r.MajAx),
		min: num(r.MinAx),
		pa: num(r.PosAng),
		mag,
		con: r.Const
	});
}
// A duplicate's own name is an alias of the object it duplicates (NGC 2244 -> NGC 2239). M 102 is left out (disputed).
for (const r of rows) {
	if (r.Type !== 'Dup' || r.M) continue;
	const target = r.NGC ? `NGC ${Number(r.NGC.split(',')[0])}` : r.IC ? `IC ${Number(r.IC.split(',')[0])}` : null;
	const o = target && objects.get(target);
	const name = designation(r.Name);
	if (o && !o.aliases.includes(name) && o.id !== name) o.aliases.push(name);
}

// Sharpless (Sh2) from Wikidata: an alias where OpenNGC already has the object (by its identifiers), else
// an object of its own (position only; several positions of one item are averaged).
const response = await fetch(`${WIKIDATA}?query=${encodeURIComponent(SHARPLESS_QUERY)}`, { headers: { accept: 'application/sparql-results+json', 'user-agent': 'homelab-telescope-catalog/1 (apps/telescope/web/scripts/catalog.mjs)' } });
if (!response.ok) throw new Error(`Wikidata: HTTP ${response.status}`);
const sharpless = new Map();
for (const b of (await response.json()).results.bindings) {
	const m = /^SH 2-0*(\d+)$/i.exec(b.code.value.trim());
	if (!m) continue;
	const id = `Sh2-${m[1]}`;
	const s = sharpless.get(id) ?? { ra: [], dec: [], label: null };
	s.ra.push(Number(b.ra.value));
	s.dec.push(Number(b.dec.value));
	if (b.label && !/^s(h|harpless)\s*2/i.test(b.label.value)) s.label = b.label.value;
	sharpless.set(id, s);
}
const known = new Set([...objects.values()].flatMap((o) => o.aliases.filter((a) => a.startsWith('Sh2-'))));
const nebulae = [...objects.values()].filter((o) => o.group === 'nebula');
const mean = (v) => Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 1e4) / 1e4;
const separation = (a, b) => {
	const r = Math.PI / 180;
	const c = Math.sin(a.dec * r) * Math.sin(b.dec * r) + Math.cos(a.dec * r) * Math.cos(b.dec * r) * Math.cos((a.ra - b.ra) * r);
	return Math.acos(Math.min(1, c)) / r;
};
let added = 0;
let merged = 0;
for (const [id, s] of sharpless) {
	if (known.has(id)) continue;
	const at = { ra: mean(s.ra), dec: mean(s.dec) };
	if (at.dec < MIN_DEC) continue;
	// Wikidata's label is an OpenNGC designation (Sh2-248 "IC 443"): the same object.
	const named = s.label ? [...objects.values()].find((o) => o.id === s.label || o.aliases.includes(s.label)) : null;
	if (named) {
		named.aliases.push(id);
		merged++;
		continue;
	}
	// The same nebula in OpenNGC without the Sh2 alias (NGC 7000 = Sh2-117): its centre within a quarter
	// degree, or within half its radius for large ones.
	let same = null;
	let best = Infinity;
	for (const o of nebulae) {
		const d = separation(at, o);
		if (d <= Math.max(0.25, (o.maj ?? 0) / 240) && d < best) {
			same = o;
			best = d;
		}
	}
	if (same) {
		same.aliases.push(id);
		merged++;
		continue;
	}
	objects.set(id, { id, aliases: [], names: s.label ? [s.label] : [], type: 'HII', group: 'nebula', ra: at.ra, dec: at.dec, maj: null, min: null, pa: null, mag: null, con: '' });
	added++;
}
console.log(`Sharpless from Wikidata: ${sharpless.size}, ${known.size} already aliases, ${merged} merged by position, ${added} added`);
const snapshot = new Date().toISOString().slice(0, 10);

const list = [...objects.values()].sort((a, b) => a.ra - b.ra);
const out = {
	sources: [
		{ name: `OpenNGC ${RELEASE}`, url: 'https://github.com/mattiaverga/OpenNGC', license: 'CC BY-SA 4.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/', attribution: 'OpenNGC by Mattia Verga; reduced to imaging targets north of −35°, converted to degrees' },
		{ name: `Wikidata, Sharpless catalogue positions, ${snapshot}`, url: 'https://www.wikidata.org/wiki/Q66381095', license: 'CC0 1.0', licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/', attribution: `${added} Sharpless objects not in OpenNGC (no sizes)` }
	],
	/** [id, aliases, common names, OpenNGC type, group, RA°, Dec°, major ′, minor ′, position angle °, magnitude (V, else B), constellation] */
	columns: ['id', 'aliases', 'names', 'type', 'group', 'ra', 'dec', 'maj', 'min', 'pa', 'mag', 'con'],
	objects: list.map((o) => [o.id, o.aliases, o.names, o.type, o.group, o.ra, o.dec, o.maj, o.min, o.pa, o.mag, o.con])
};
writeFileSync(OUT, JSON.stringify(out) + '\n');
console.log(`${list.length} objects -> ${OUT.pathname}`);
