#!/usr/bin/env node
// Builds src/lib/catalog/stars.json, the bright stars the image viewer labels (B2):
// - HYG v4.4 (https://codeberg.org/astronexus/hyg, CC-BY-SA-4.0, David Nash / astronexus), pinned to a commit
//   and checked against its Git LFS checksum. HYG's `proper` column carries the IAU Working Group on Star
//   Names' official names (added to HYG in 2023), its positions come from Hipparcos and the Yale Bright Star
//   Catalogue.
// Run by hand when moving to a new release: update COMMIT, FILE and SHA256, then `node scripts/stars.mjs`
// and commit the JSON.
//
// Changes made to HYG's data (the licence asks for them to be indicated): reduced to stars north of MIN_DEC
// with a proper name (brighter than NAMED_MAG) or a Bayer or Flamsteed designation (brighter than
// DESIGNATED_MAG); positions moved by their proper motion from J2000 to EPOCH; Bayer abbreviations written as
// Greek letters; columns reduced to the ones below.
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

const COMMIT = '53e3df311869e813ace5f1ad2ec4ce909f13256c';
const FILE = 'data/hyg/CURRENT/hyg_v44.csv.gz';
const SHA256 = '00b349893b9a53106dd488d8371e8d2fa586043e500bb3cdb8bff3931682197d';
const OUT = new URL('../src/lib/catalog/stars.json', import.meta.url);
const MIN_DEC = -45;
const NAMED_MAG = 8;
const DESIGNATED_MAG = 6.5;
/** Positions for this epoch (Julian years): a few arcseconds off over a decade at most for the fast movers. */
const EPOCH = 2026.0;

const GREEK = {
	Alp: 'α', Bet: 'β', Gam: 'γ', Del: 'δ', Eps: 'ε', Zet: 'ζ', Eta: 'η', The: 'θ', Iot: 'ι', Kap: 'κ', Lam: 'λ', Mu: 'μ',
	Nu: 'ν', Xi: 'ξ', Omi: 'ο', Pi: 'π', Rho: 'ρ', Sig: 'σ', Tau: 'τ', Ups: 'υ', Phi: 'φ', Chi: 'χ', Psi: 'ψ', Ome: 'ω'
};
const SUPERSCRIPT = ['⁰', '¹', '²', '³', '⁴', '⁵', '⁶', '⁷', '⁸', '⁹'];

const url = `https://codeberg.org/astronexus/hyg/media/commit/${COMMIT}/${FILE}`;
const response = await fetch(url);
if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
const gz = Buffer.from(await response.arrayBuffer());
const sum = createHash('sha256').update(gz).digest('hex');
if (sum !== SHA256) throw new Error(`${FILE}: sha256 ${sum}, expected ${SHA256}`);

/** One CSV line, fields optionally quoted (HYG quotes its text columns; none contain quotes or commas). */
const split = (line) => line.split(',').map((v) => v.replace(/^"(.*)"$/, '$1'));
const [head, ...lines] = gunzipSync(gz).toString('utf8').trim().split(/\r?\n/);
const cols = split(head);
const at = Object.fromEntries(cols.map((c, i) => [c, i]));

/** "Alp-1" -> "α¹", "Bet" -> "β". */
function bayer(code) {
	const [abbr, n] = code.split('-');
	const letter = GREEK[abbr];
	if (!letter) return null;
	return letter + (n ? [...n].map((d) => SUPERSCRIPT[Number(d)] ?? d).join('') : '');
}

const round = (v, digits) => Math.round(v * 10 ** digits) / 10 ** digits;
const stars = [];
for (const line of lines) {
	const f = split(line);
	const mag = Number(f[at.mag]);
	let dec = Number(f[at.dec]);
	if (!Number.isFinite(mag) || !Number.isFinite(dec) || dec < MIN_DEC || f[at.proper] === 'Sol') continue;
	const con = f[at.con];
	const letter = f[at.bayer] ? bayer(f[at.bayer]) : null;
	const designation = con && letter ? `${letter} ${con}` : con && f[at.flam] ? `${f[at.flam]} ${con}` : null;
	const name = f[at.proper] && mag <= NAMED_MAG ? f[at.proper] : null;
	if (!name && !(designation && mag <= DESIGNATED_MAG)) continue;
	// Proper motion (mas/yr, RA's already × cos dec) from J2000 to EPOCH.
	const years = EPOCH - 2000;
	let ra = Number(f[at.ra]) * 15;
	const cos = Math.cos((dec * Math.PI) / 180);
	if (cos > 1e-6) ra += ((Number(f[at.pmra]) || 0) * years) / 3.6e6 / cos;
	dec += ((Number(f[at.pmdec]) || 0) * years) / 3.6e6;
	stars.push([name, designation, round(((ra % 360) + 360) % 360, 5), round(dec, 5), round(mag, 2)]);
}
stars.sort((a, b) => a[4] - b[4]);

const out = {
	sources: [
		{
			name: 'HYG v4.4',
			url: 'https://codeberg.org/astronexus/hyg',
			license: 'CC BY-SA 4.0',
			licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
			attribution: `HYG database by David Nash (astronexus), with the IAU WGSN star names; stars with a name (to mag ${NAMED_MAG}) or a Bayer/Flamsteed designation (to mag ${DESIGNATED_MAG}) north of ${MIN_DEC}°, positions at epoch ${EPOCH}`
		}
	],
	epoch: EPOCH,
	/** [proper name (IAU WGSN) | null, Bayer or Flamsteed designation | null, RA°, Dec°, magnitude], brightest first */
	columns: ['name', 'designation', 'ra', 'dec', 'mag'],
	stars
};
writeFileSync(OUT, JSON.stringify(out) + '\n');
console.log(`${stars.length} stars (${stars.filter((s) => s[0]).length} named) -> ${OUT.pathname}`);
