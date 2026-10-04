// Live check of one outlet module: discovery summary, then extraction of n random articles.
// Usage: node --experimental-strip-types scripts/outlet-smoke.ts <slug> [n] [url ...]
import { blocksText } from '../src/lib/core/blocks.ts';
import { OUTLETS, outletBySlug } from '../src/lib/core/outlets/index.ts';
import { ExtractError } from '../src/lib/core/outlets/types.ts';

const [slug, nArg, ...urls] = process.argv.slice(2);
const outlet = slug ? outletBySlug(slug) : undefined;
if (!outlet) {
	console.error(`usage: outlet-smoke.ts <${OUTLETS.map((o) => o.slug).join('|')}> [n] [url ...]`);
	process.exit(2);
}
const n = Number(nArg ?? 5);

const fmt = (d?: Date) => (d ? d.toISOString().slice(0, 16).replace('T', ' ') : '-');

let sample = urls;
if (!sample.length) {
	const t0 = Date.now();
	const found = await outlet.discover();
	const dated = found.filter((d) => d.publishedAt).map((d) => d.publishedAt!.getTime());
	console.log(`# ${outlet.name}: discovered ${found.length} in ${Date.now() - t0} ms (${dated.length} dated)`);
	if (dated.length) console.log(`  newest ${fmt(new Date(Math.max(...dated)))}  oldest ${fmt(new Date(Math.min(...dated)))}`);
	for (const d of found.slice(0, 5)) console.log(`  - ${fmt(d.publishedAt)}  ${d.title}`);
	sample = [...found]
		.sort(() => Math.random() - 0.5)
		.slice(0, n)
		.map((d) => d.url);
}

const tally = { extracted: 0, paywalled: 0, skipped: 0, failed: 0 };
for (const url of sample) {
	console.log(`\n## ${url}`);
	try {
		const a = await outlet.extract(url);
		if (a.paywalled) {
			tally.paywalled++;
			console.log(`  PAYWALLED  title: ${a.title}  (blocks ${a.blocks.length}, images ${a.images.length})`);
			continue;
		}
		tally.extracted++;
		const text = blocksText(a.blocks);
		const paragraphs = a.blocks.filter((b) => b.type === 'p');
		console.log(`  title: ${a.title}`);
		console.log(`  lead: ${a.lead ?? '-'}`);
		console.log(`  author: ${a.author ?? '-'}  published: ${fmt(a.publishedAt)}  language: ${a.language ?? '-'}`);
		console.log(`  blocks ${a.blocks.length} (p ${paragraphs.length}, h ${a.blocks.filter((b) => b.type === 'h').length}, quote ${a.blocks.filter((b) => b.type === 'quote').length}, list ${a.blocks.filter((b) => b.type === 'list').length}, figure ${a.blocks.filter((b) => b.type === 'figure').length}), body chars ${text.length}`);
		console.log(`  images ${a.images.length}:`);
		for (const img of a.images) {
			console.log(`    [${img.position}] caption:${img.caption ? 'yes' : 'NO '} credit:${img.credit ? 'yes' : 'NO '}  ${img.url.slice(0, 110)}`);
			if (img.caption) console.log(`        “${img.caption.slice(0, 120)}” ${img.credit ? `(${img.credit})` : ''}`);
		}
		if (a.meta) console.log(`  meta: ${JSON.stringify(a.meta).slice(0, 200)}`);
		console.log(`  first: ${text.slice(0, 200)}`);
		if (paragraphs.length) console.log(`  last p: ${(paragraphs[paragraphs.length - 1] as { text: string }).text.slice(0, 200)}`);
	} catch (e) {
		if (e instanceof ExtractError) {
			tally[e.state]++;
			console.log(`  ${e.state.toUpperCase()}: ${e.message}`);
		} else {
			tally.failed++;
			console.log(`  ERROR: ${(e as Error).message}`);
		}
	}
}
console.log(`\n# ${outlet.slug}: ${JSON.stringify(tally)}`);
