// Imports the old Google Sheet log (one tab per year) into `workouts`.
//   DATABASE_URL=postgres://... node --experimental-strip-types scripts/import-sheet.ts --url <sheet URL> [--dry-run]
//   ... scripts/import-sheet.ts --file book.xlsx
// The sheet must be shared "Anyone with the link: Viewer" for --url.
//
// Sheet format: one row per ISO week (Monday's date in the date column), seven day cells per person.
// A day cell holds comma-separated workouts, "<prefix> <km>" with prefix TR (treadmill), CT (cross
// trainer) or R (rowing); no prefix means treadmill (the sheet's own SUM_WITH_PREFIX formulas count
// it as TR). 2022-2023 cells are plain numbers, sometimes a sum formula (=3.3+1.36+5) for several
// workouts that day; each addend becomes one workout.
//
// Safety: every week's parsed sums must equal the sheet's own weekly total columns (cached formula
// results), otherwise nothing is written. Re-running replaces all previously imported rows
// (source 'sheet:...') in one transaction and never touches workouts logged in the app.
import { parseArgs } from 'node:util';
import ExcelJS from 'exceljs';
import { db, migrate } from '../src/lib/server/db.ts';
import { MACHINES, addDays, type MachineId, type PersonId } from '../src/lib/domain.ts';

interface Tab {
	/** Column holding the week's Monday. */
	dateCol: string;
	/** Seven day columns (Mon-Sun) per person. */
	days: Partial<Record<PersonId, string[]>>;
	/** Weekly total columns to reconcile against: per machine, or `all` for the pre-2024 single total. */
	totals: Partial<Record<PersonId, Partial<Record<MachineId | 'all', string>>>>;
}

const DAYS = (cols: string) => cols.split(' ');

// Other tabs (films, fitness tests, personal records) are not workout logs. 2023 also has a third
// person (Ansku, 5 workouts) who is not imported.
const TABS: Record<string, Tab> = {
	'2022': {
		dateCol: 'A',
		days: { jari: DAYS('C D E F G H I'), elina: DAYS('L M N O P Q R') },
		totals: { jari: { all: 'J' }, elina: { all: 'S' } }
	},
	'2023': {
		dateCol: 'A',
		days: { jari: DAYS('C D E F G H I'), elina: DAYS('L M N O P Q R') },
		totals: { jari: { all: 'J' }, elina: { all: 'S' } }
	},
	'2024': {
		dateCol: 'B',
		days: { jari: DAYS('D E F G H I J'), elina: DAYS('S T U V W X Y') },
		totals: { jari: { treadmill: 'K', crosstrainer: 'N' }, elina: { treadmill: 'Z', crosstrainer: 'AC' } }
	},
	'2025': {
		dateCol: 'B',
		days: { jari: DAYS('D E F G H I J'), elina: DAYS('V W X Y Z AA AB') },
		totals: {
			jari: { treadmill: 'K', crosstrainer: 'N', rowing: 'Q' },
			elina: { treadmill: 'AC', crosstrainer: 'AF', rowing: 'AI' }
		}
	},
	'2026': {
		dateCol: 'B',
		days: { jari: DAYS('D E F G H I J'), elina: DAYS('V W X Y Z AA AB') },
		totals: {
			jari: { treadmill: 'K', crosstrainer: 'N', rowing: 'Q' },
			elina: { treadmill: 'AC', crosstrainer: 'AF', rowing: 'AI' }
		}
	}
};

const MACHINE_BY_PREFIX: Record<string, MachineId> = Object.fromEntries(MACHINES.map((m) => [m.short, m.id]));

interface Imported {
	person: PersonId;
	machine: MachineId;
	day: string;
	meters: number;
	source: string;
}

/** Workouts in one day cell; throws on anything it does not understand. */
function parseCell(value: ExcelJS.CellValue): { machine: MachineId; meters: number }[] {
	if (value === null || value === undefined || value === '') return [];
	if (typeof value === 'number') return [{ machine: 'treadmill', meters: Math.round(value * 1000) }];
	const formula = typeof value === 'object' && 'formula' in value ? value.formula : undefined;
	if (formula && /^[\d.+]+$/.test(formula)) {
		return formula.split('+').map((km) => ({ machine: 'treadmill', meters: Math.round(Number(km) * 1000) }));
	}
	if (typeof value !== 'string') throw new Error(`unexpected cell ${JSON.stringify(value)}`);
	return value.split(',').map((token) => {
		const m = /^(?:(TR|CT|R)\s+)?(\d+(?:[.,]\d+)?)$/.exec(token.trim());
		if (!m) throw new Error(`unexpected cell text "${value}"`);
		return { machine: m[1] ? MACHINE_BY_PREFIX[m[1]] : 'treadmill', meters: Math.round(Number(m[2].replace(',', '.')) * 1000) };
	});
}

/** A cell's plain or cached-formula value. */
function resultOf(value: ExcelJS.CellValue): unknown {
	return value !== null && typeof value === 'object' && 'result' in value ? value.result : value;
}

function readTab(sheet: ExcelJS.Worksheet, name: string, tab: Tab, problems: string[]): Imported[] {
	const out: Imported[] = [];
	for (let r = 1; r <= sheet.rowCount; r++) {
		const monday = resultOf(sheet.getCell(`${tab.dateCol}${r}`).value);
		if (!(monday instanceof Date)) continue;
		const start = monday.toISOString().slice(0, 10);
		for (const [person, cols] of Object.entries(tab.days) as [PersonId, string[]][]) {
			const sums: Record<string, number> = { all: 0, treadmill: 0, crosstrainer: 0, rowing: 0 };
			cols.forEach((col, i) => {
				const address = `${col}${r}`;
				try {
					parseCell(sheet.getCell(address).value).forEach((w, n, all) => {
						out.push({ person, ...w, day: addDays(start, i), source: `sheet:${name}!${address}${all.length > 1 ? `#${n + 1}` : ''}` });
						sums[w.machine] += w.meters;
						sums.all += w.meters;
					});
				} catch (e) {
					problems.push(`${name}!${address}: ${(e as Error).message}`);
				}
			});
			for (const [kind, col] of Object.entries(tab.totals[person] ?? {})) {
				const cached = resultOf(sheet.getCell(`${col}${r}`).value);
				const expected = typeof cached === 'number' ? Math.round(cached * 1000) : 0;
				if (expected !== sums[kind]) {
					problems.push(`${name} row ${r} ${person} ${kind}: sheet total ${expected / 1000} km, parsed ${sums[kind] / 1000} km`);
				}
			}
		}
	}
	return out;
}

async function loadWorkbook(url?: string, file?: string): Promise<ExcelJS.Workbook> {
	const workbook = new ExcelJS.Workbook();
	if (file) return workbook.xlsx.readFile(file);
	const id = /\/spreadsheets\/d\/([\w-]+)/.exec(url ?? '')?.[1];
	if (!id) throw new Error('give --url <Google Sheet URL> or --file <xlsx>');
	const res = await fetch(`https://docs.google.com/spreadsheets/d/${id}/export?format=xlsx`);
	const type = res.headers.get('content-type') ?? '';
	if (!res.ok || !type.includes('spreadsheetml')) {
		throw new Error(`download failed (${res.status} ${type}); is the sheet shared "Anyone with the link"?`);
	}
	return workbook.xlsx.load(await res.arrayBuffer());
}

const { values } = parseArgs({
	options: { url: { type: 'string' }, file: { type: 'string' }, 'dry-run': { type: 'boolean', default: false } }
});

const workbook = await loadWorkbook(values.url, values.file);
const problems: string[] = [];
const workouts: Imported[] = [];
for (const [name, tab] of Object.entries(TABS)) {
	const sheet = workbook.getWorksheet(name);
	if (!sheet) {
		problems.push(`tab ${name} is missing`);
		continue;
	}
	workouts.push(...readTab(sheet, name, tab, problems));
}
if (problems.length > 0) {
	console.error(`Not imported; ${problems.length} problem(s):\n  ${problems.join('\n  ')}`);
	process.exit(1);
}

workouts.sort((a, b) => a.day.localeCompare(b.day));
const summary: Record<string, { count: number; km: number }> = {};
for (const w of workouts) {
	const key = `${w.day.slice(0, 4)} ${w.person} ${w.machine}`;
	summary[key] ??= { count: 0, km: 0 };
	summary[key].count++;
	summary[key].km += w.meters / 1000;
}
console.table(Object.fromEntries(Object.entries(summary).map(([k, v]) => [k, { workouts: v.count, km: Number(v.km.toFixed(2)) }])));
console.log(`${workouts.length} workouts, ${workouts[0]?.day} to ${workouts.at(-1)?.day}; all weekly totals match the sheet.`);

if (values['dry-run']) process.exit(0);

const sql = db();
await migrate(sql, new URL('../migrations', import.meta.url).pathname);
await sql.begin(async (tx) => {
	const removed = await tx`DELETE FROM workouts WHERE source LIKE 'sheet:%'`;
	for (let i = 0; i < workouts.length; i += 500) {
		await tx`INSERT INTO workouts ${tx(workouts.slice(i, i + 500), 'person', 'machine', 'day', 'meters', 'source')}`;
	}
	console.log(`replaced ${removed.count} previously imported rows with ${workouts.length}`);
});
await sql.end();
