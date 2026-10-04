// Classifier model benchmark on real extracted articles (DESIGN.md §5.4).
//
//   node --experimental-strip-types scripts/benchmark.ts [--pick] [--ids=1,2,3] [--n=20] [--runs=1]
//   node --experimental-strip-types scripts/benchmark.ts --append --runs=2   (repeat runs, same articles)
//   node --experimental-strip-types scripts/benchmark.ts --report-only
//
// Picks a deliberately sensitive mix of extracted articles (crime, war, accidents, illness,
// animals, plus ordinary news, many with photos) from at least three outlets, classifies each with
// every model, and compares against the reference model. Raw results go to
// .cache/benchmark.json so the report can be re-derived (--report-only) without new calls;
// --pick only prints the automatic selection.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { classify, type ClassifyResult } from '../src/lib/core/classify.ts';
import { db } from '../src/lib/core/db.ts';
import { llmConfigFromEnv } from '../src/lib/core/llm.ts';
import { loadClassifyInput } from '../src/lib/core/pipeline/classification.ts';
import { INTENSITIES } from '../src/lib/core/taxonomy.ts';

const MODELS = ['claude-haiku-4-5', 'claude-sonnet-5', 'claude-sonnet-5-5', 'claude-opus-5-5'];
const REFERENCE = 'claude-opus-5-5';
const RESULTS = '.cache/benchmark.json';
const CONCURRENCY = 4;

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')).map(([k, v]) => [k, v ?? 'true']));

/** Title/body patterns used only to pick a sensitive mix of articles (fi + en). */
const CATEGORIES: Record<string, RegExp> = {
	crime: /murha|tapo|puukot|ampu|pahoinpitel|raiskau|poliisi|rikos|murder|stabb|shoot|assault|police/i,
	war: /sota|ukrain|gaza|israel|venäj|ohjus|drooni|hyökkä|war\b|missile|strike|troops/i,
	accident: /onnettomuu|kolari|tulipalo|hukku|törmä|crash|accident|fire|drown/i,
	illness: /syöpä|sairau|kuoli|kuolema|sairaala|cancer|illness|disease|died|death|hospital/i,
	animals: /koira|kissa|hämähäk|käärme|eläin|hevonen|karhu|susi|dog|cat\b|spider|snake|animal|bear|wolf/i
};

interface Article {
	id: number;
	outlet: string;
	title: string;
	text: string;
	photos: number;
}

async function pickArticles(n: number): Promise<number[]> {
	const sql = db();
	const rows = await sql<Article[]>`
		SELECT a.id, o.slug AS outlet, a.title, left(a.body::text, 6000) AS text,
			(SELECT count(*)::int FROM images i WHERE i.article_id = a.id AND i.state = 'stored') AS photos
		FROM articles a JOIN outlets o ON o.id = a.outlet_id
		WHERE a.content_state = 'extracted' AND a.body_purged_at IS NULL
		ORDER BY a.published_at DESC LIMIT 600`;
	const chosen: Article[] = [];
	const take = (pool: Article[], count: number) => {
		// Round-robin over outlets, preferring articles with photos.
		const byOutlet = new Map<string, Article[]>();
		for (const a of [...pool].sort((x, y) => Number(y.photos > 0) - Number(x.photos > 0))) {
			if (chosen.some((c) => c.id === a.id)) continue;
			byOutlet.set(a.outlet, [...(byOutlet.get(a.outlet) ?? []), a]);
		}
		let added = 0;
		while (added < count && [...byOutlet.values()].some((l) => l.length > 0)) {
			for (const list of byOutlet.values()) {
				const next = list.shift();
				if (next && added < count) {
					chosen.push(next);
					added++;
				}
			}
		}
	};
	const perCategory = Math.floor((n * 0.75) / Object.keys(CATEGORIES).length);
	for (const re of Object.values(CATEGORIES)) take(rows.filter((r) => re.test(r.title) || re.test(r.text)), perCategory);
	take(rows, n - chosen.length);
	return chosen.map((c) => c.id);
}

interface RunRecord {
	articleId: number;
	model: string;
	ok: boolean;
	error?: string;
	latencyMs?: number;
	inputTokens?: number | null;
	outputTokens?: number | null;
	cacheReadTokens?: number | null;
	result?: Omit<ClassifyResult, 'call' | 'imageTags'> & { imageTags: [number, { tag: string; intensity: string }[]][] };
}

interface Saved {
	ids: number[];
	meta: Record<number, { outlet: string; title: string; photos: number }>;
	runs: RunRecord[];
}

/** Run labels: "model" for the first run, "model#2" … for repeats (same model, same inputs). */
const labels = (runs: number) => Array.from({ length: runs }, (_, i) => MODELS.map((m) => (i === 0 ? m : `${m}#${i + 1}`))).flat();

async function runBenchmark(ids: number[], todo: string[], previous?: Saved): Promise<Saved> {
	const sql = db();
	const config = llmConfigFromEnv();
	const meta: Saved['meta'] = {};
	const inputs = [];
	for (const id of ids) {
		const loaded = await loadClassifyInput(sql, id);
		if (!loaded) throw new Error(`article ${id} has no body`);
		const [row] = await sql`SELECT o.slug FROM articles a JOIN outlets o ON o.id = a.outlet_id WHERE a.id = ${id}`;
		meta[id] = { outlet: row.slug, title: loaded.input.title, photos: loaded.input.images.filter((i) => i.jpeg).length };
		inputs.push({ id, input: loaded.input });
	}
	const runs: RunRecord[] = previous?.runs ?? [];
	for (const model of todo) {
		const queue = [...inputs];
		const started = Date.now();
		await Promise.all(
			Array.from({ length: CONCURRENCY }, async () => {
				for (let job = queue.shift(); job; job = queue.shift()) {
					try {
						const r = await classify(config, job.input, model.replace(/#\d+$/, ''));
						const { call, imageTags, ...rest } = r;
						runs.push({
							articleId: job.id,
							model,
							ok: true,
							latencyMs: call.latencyMs,
							inputTokens: call.inputTokens,
							outputTokens: call.outputTokens,
							cacheReadTokens: call.cacheReadTokens,
							result: { ...rest, imageTags: [...imageTags.entries()] }
						});
					} catch (e) {
						runs.push({ articleId: job.id, model, ok: false, error: (e as Error).message.slice(0, 300) });
					}
				}
			})
		);
		console.error(`${model}: ${inputs.length} articles in ${Math.round((Date.now() - started) / 1000)} s`);
	}
	return { ids, meta, runs };
}

const percentile = (values: number[], p: number) => {
	if (values.length === 0) return NaN;
	const sorted = [...values].sort((a, b) => a - b);
	return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
};
const mean = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : NaN);
const level = (i: string) => INTENSITIES.indexOf(i as (typeof INTENSITIES)[number]) + 1;

function report(saved: Saved): string {
	const out: string[] = [];
	const ref = new Map(saved.runs.filter((r) => r.model === REFERENCE && r.ok).map((r) => [r.articleId, r.result!]));
	// Stable reference: tags every reference run agrees on, at the lowest intensity any of them gave.
	// Removes the reference model's own run-to-run noise from the under-call measure.
	const refRuns = saved.runs.filter((r) => r.model.replace(/#\d+$/, '') === REFERENCE && r.ok);
	const stable = new Map<number, Map<string, number>>();
	for (const id of saved.ids) {
		const runsForId = refRuns.filter((r) => r.articleId === id).map((r) => new Map(r.result!.tags.map((t) => [t.tag, level(t.intensity)])));
		if (runsForId.length === 0) continue;
		const agreed = new Map<string, number>();
		for (const [tag, l] of runsForId[0]) if (runsForId.every((m) => m.has(tag))) agreed.set(tag, Math.min(l, ...runsForId.map((m) => m.get(tag)!)));
		stable.set(id, agreed);
	}
	const stableCount = [...stable.values()].reduce((s, m) => s + m.size, 0);
	const outlets = new Set(saved.ids.map((id) => saved.meta[id].outlet));
	const present = [...new Set(saved.runs.map((r) => r.model))].sort((a, b) => MODELS.indexOf(a.replace(/#\d+$/, '')) - MODELS.indexOf(b.replace(/#\d+$/, '')) || a.localeCompare(b));
	out.push(`Articles: ${saved.ids.length} from ${outlets.size} outlets (${[...outlets].join(', ')}); ${saved.ids.filter((id) => saved.meta[id].photos > 0).length} with photos, ${saved.ids.reduce((s, id) => s + saved.meta[id].photos, 0)} photos in total. Reference: ${REFERENCE} (${ref.size} ok); stable reference: ${stableCount} tags agreed by all ${new Set(refRuns.map((r) => r.model)).size} reference runs.`);
	out.push('');
	out.push('| Run | ok/fail | p50 s | p90 s | in tok (mean) | out tok (mean) | cached (mean) | tag precision | tag recall | exact intensity | under-call rate | of which absent | under-call vs stable ref | over-call rate | primary topic | importance MAD |');
	out.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
	for (const model of present) {
		const runs = saved.runs.filter((r) => r.model === model);
		const ok = runs.filter((r) => r.ok);
		let tp = 0;
		let predicted = 0;
		let actual = 0;
		let shared = 0;
		let exact = 0;
		let under = 0;
		let absent = 0;
		let stableUnder = 0;
		let stableTotal = 0;
		let over = 0;
		let topic = 0;
		let compared = 0;
		const importance: number[] = [];
		for (const r of ok) {
			const reference = ref.get(r.articleId);
			if (!reference) continue;
			compared++;
			const mine = new Map(r.result!.tags.map((t) => [t.tag, level(t.intensity)]));
			const theirs = new Map(reference.tags.map((t) => [t.tag, level(t.intensity)]));
			predicted += mine.size;
			actual += theirs.size;
			const agreed = stable.get(r.articleId) ?? new Map<string, number>();
			stableTotal += agreed.size;
			for (const [tag, refLevel] of agreed) if ((mine.get(tag) ?? 0) < refLevel) stableUnder++;
			for (const [tag, refLevel] of theirs) {
				const myLevel = mine.get(tag);
				if (myLevel === undefined || myLevel < refLevel) under++;
				if (myLevel === undefined) absent++;
				if (myLevel !== undefined) {
					tp++;
					shared++;
					if (myLevel === refLevel) exact++;
				}
			}
			for (const [tag, myLevel] of mine) if ((theirs.get(tag) ?? 0) < myLevel) over++;
			if (r.result!.topics[0]?.topic === reference.topics[0]?.topic) topic++;
			importance.push(Math.abs(r.result!.importance - reference.importance));
		}
		const pct = (a: number, b: number) => (b ? `${((100 * a) / b).toFixed(0)} %` : '–');
		const latency = ok.map((r) => r.latencyMs! / 1000);
		out.push(
			`| ${model} | ${ok.length}/${runs.length - ok.length} | ${percentile(latency, 50).toFixed(1)} | ${percentile(latency, 90).toFixed(1)} | ${mean(ok.map((r) => r.inputTokens ?? 0)).toFixed(0)} | ${mean(ok.map((r) => r.outputTokens ?? 0)).toFixed(0)} | ${mean(ok.map((r) => r.cacheReadTokens ?? 0)).toFixed(0)} | ${pct(tp, predicted)} | ${pct(tp, actual)} | ${pct(exact, shared)} | ${pct(under, actual)} | ${pct(absent, actual)} | ${pct(stableUnder, stableTotal)} | ${pct(over, predicted)} | ${pct(topic, compared)} | ${mean(importance).toFixed(2)} |`
		);
	}
	out.push('');
	out.push('Failures:');
	for (const r of saved.runs.filter((r) => !r.ok)) out.push(`- ${r.model} article ${r.articleId}: ${r.error}`);
	out.push('');
	out.push('Per-article reference tags vs. models (tag:intensity 1-3):');
	for (const id of saved.ids) {
		out.push(`- ${id} [${saved.meta[id].outlet}, ${saved.meta[id].photos} photos] ${saved.meta[id].title}`);
		for (const model of present) {
			const r = saved.runs.find((x) => x.model === model && x.articleId === id);
			const tags = r?.ok ? r.result!.tags.map((t) => `${t.tag}:${level(t.intensity)}`).sort().join(' ') : 'FAILED';
			out.push(`    ${model.padEnd(20)} imp=${r?.result?.importance ?? '-'} topic=${r?.result?.topics[0]?.topic ?? '-'} ${tags}`);
		}
	}
	out.push('');
	out.push('Calm headlines and summaries:');
	for (const id of saved.ids) {
		out.push(`- ${id} original: ${saved.meta[id].title}`);
		for (const model of present) {
			const r = saved.runs.find((x) => x.model === model && x.articleId === id);
			if (r?.ok) out.push(`    ${model.padEnd(20)} ${r.result!.calmTitle} | ${r.result!.summary}`);
		}
	}
	return out.join('\n');
}

let saved: Saved;
if (args.pick) {
	const ids = await pickArticles(Number(args.n ?? 20));
	const rows = await db()`SELECT a.id, o.slug, a.title FROM articles a JOIN outlets o ON o.id = a.outlet_id WHERE a.id = ANY(${ids}::bigint[])`;
	for (const r of rows) console.log(`${r.id} [${r.slug}] ${r.title}`);
	console.log(`--ids=${ids.join(',')}`);
	await db().end();
	process.exit(0);
}
if (args['report-only']) {
	saved = JSON.parse(await readFile(RESULTS, 'utf8')) as Saved;
} else if (args.append) {
	// Adds repeat runs (--runs=N) to the saved results, on the same articles.
	const previous = JSON.parse(await readFile(RESULTS, 'utf8')) as Saved;
	const done = new Set(previous.runs.map((r) => r.model));
	saved = await runBenchmark(previous.ids, labels(Number(args.runs ?? 2)).filter((l) => !done.has(l)), previous);
	await writeFile(RESULTS, JSON.stringify(saved, null, '\t'));
} else {
	const ids = args.ids ? args.ids.split(',').map(Number) : await pickArticles(Number(args.n ?? 20));
	saved = await runBenchmark(ids, labels(Number(args.runs ?? 1)));
	await mkdir('.cache', { recursive: true });
	await writeFile(RESULTS, JSON.stringify(saved, null, '\t'));
}
console.log(report(saved));
if (!args['report-only']) await db().end();
