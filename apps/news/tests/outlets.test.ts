// Outlet extractors against trimmed real pages (tests/fixtures/outlets/, fetched 2026-10-04), the
// shared parsing helpers, and idempotent outlet seeding (rolled back, needs DATABASE_URL).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import postgres from 'postgres';
import { blocksText, type Block, type ExtractedArticle } from '../src/lib/core/blocks.ts';
import { BIGINT_AS_NUMBER } from '../src/lib/core/db.ts';
import { assignedState, Body, ldFree, normalizeUrl, parseFeed, parseNewsSitemap, pick, resolveReactStream, parseDoc, stripMarkdown } from '../src/lib/core/outlets/common.ts';
import { parseArticle as iltalehti } from '../src/lib/core/outlets/iltalehti.ts';
import { OUTLETS, seedOutlets } from '../src/lib/core/outlets/index.ts';
import { parseArticle as mtv } from '../src/lib/core/outlets/mtv.ts';
import { parseArticle as npr } from '../src/lib/core/outlets/npr.ts';
import { parseSanoma } from '../src/lib/core/outlets/sanoma.ts';
import { parseArticle as seiska } from '../src/lib/core/outlets/seiska.ts';
import { parseArticle as yle } from '../src/lib/core/outlets/yle.ts';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/outlets/${name}`, import.meta.url), 'utf8');
const paragraphs = (a: ExtractedArticle) => a.blocks.filter((b): b is Extract<Block, { type: 'p' }> => b.type === 'p').map((b) => b.text);
const figures = (a: ExtractedArticle) => a.blocks.filter((b): b is Extract<Block, { type: 'figure' }> => b.type === 'figure');

/** Invariants every extracted article keeps: lead at 0, figures 1..n in order, each image used. */
function assertWellFormed(a: ExtractedArticle) {
	assert.equal(a.paywalled, false);
	const positions = figures(a).map((f) => f.image);
	assert.deepEqual(positions, positions.map((_, i) => i + 1), 'figures numbered 1..n in document order');
	const imagePositions = a.images.map((i) => i.position).filter((p) => p > 0);
	assert.deepEqual(imagePositions, positions, 'every body image has exactly one figure block');
	for (const img of a.images) assert.match(img.url, /^https:\/\//);
	for (const text of paragraphs(a)) assert.equal(text, text.trim());
}

function assertLocked(a: ExtractedArticle, html: string, subscriberText: string) {
	// The page does ship (part of) the locked body; the extractor must not use it.
	assert.ok(html.includes(subscriberText), 'fixture carries subscriber text');
	assert.equal(a.paywalled, true);
	assert.deepEqual(a.blocks, []);
	assert.deepEqual(a.images, []);
	assert.ok(!JSON.stringify(a).includes(subscriberText));
	assert.ok(a.title.length > 0);
}

test('yle: state JSON article with fact box, figures and Markdown removed', () => {
	const a = yle(fixture('yle-free.html'), 'https://yle.fi/a/74-20240637');
	assertWellFormed(a);
	assert.equal(a.title, 'Anna Mantere kotiopetti lapsiaan, kunnes luovutti: ”Menkää sitten kouluun ja sanokaa siellä ei”');
	assert.equal(a.lead, 'Anna Mantere vannoi: en laita lapsiani kouluun, vaan opetan heitä kotona. Vuosien jälkeen hän lopetti. Nyt äiti kertoo, miksi.');
	assert.equal(a.author, 'Sara Hussein, Jessica Stolzmann');
	assert.equal(a.language, 'fi');
	assert.equal(a.publishedAt?.toISOString(), '2026-10-04T15:00:35.000Z');
	const ps = paragraphs(a);
	assert.ok(ps.length >= 50);
	assert.equal(ps[0], '– Mä oon päättänyt kotikouluttaa ennen kuin mun ensimmäinen lapsi on syntynytkään, Anna Mantere sanoo Janakkalan pääkirjastossa.');
	assert.equal(a.images[0].position, 0);
	assert.equal(a.images[0].caption, 'Kotiopetuksessa olevat lapset lukevat kirjastossa.');
	assert.equal(a.images[0].credit, 'Juha Kivioja / Yle');
	assert.match(a.images[0].url, /^https:\/\/img\.img-cdn\.yle\.fi\/w_1440,f_jpg\/39-/);
	assert.ok(figures(a).length >= 4);
	const text = blocksText(a.blocks);
	assert.ok(text.includes('Kotiopetus Suomessa'), 'fact box kept');
	assert.ok(!text.includes('Juttu tiivistettynä'), 'machine summary dropped');
	assert.ok(!/\*\*|\]\(/.test(text), 'Markdown removed');
});

test('hs: metered article is read in full', () => {
	const a = parseSanoma(fixture('hs-metered.html'), 'https://www.hs.fi/urheilu/art-2000012319740.html', 'fi');
	assertWellFormed(a);
	assert.equal(a.title, 'Sami Pajari tyytyväisenä: ”Pronssi on MM-mitali”');
	assert.equal(a.lead, 'Sami Pajari ei yltänyt mestariksi, mutta oli tyytyväinen MM-kauteensa.');
	assert.equal(a.author, 'Tuomas Arkimies');
	const ps = paragraphs(a);
	assert.ok(ps.length >= 30);
	assert.equal(ps[0], 'Suomalaiskuljettaja Sami Pajari, 24, päätyi lopulta kolmanneksi rallin MM-sarjassa tällä kaudella.');
	assert.equal(a.images[0].caption, 'Sami Pajari, 24, otti MM-pronssia.');
	assert.equal(a.images[0].credit, 'Nikos Katikis');
	assert.equal(a.images[0].url, 'https://images.sanoma-sndp.fi/3a43da299b84d9c59419c3986f19e68d/normal/1440.jpg');
	assert.equal(figures(a).length, 3);
	assert.equal(pick(a.meta, 'paidType'), 'metered');
});

test('hs: paid article is paywalled and empty', () => {
	const html = fixture('hs-paid.html');
	const a = parseSanoma(html, 'https://www.hs.fi/popkulttuuri/art-2000012219129.html', 'fi');
	assertLocked(a, html, 'pihalla vanhojen omenapuiden katveessa seisova Volvo');
	assert.equal(a.title, 'Taiteilijapari elää jatkuvassa rahapulassa, mutta juuri tällaista elämää he haluavat');
});

test('hs: subscriber access opens a paid article with the access service body, without repeating the free part', () => {
	const url = 'https://www.hs.fi/popkulttuuri/art-2000012219129.html';
	const locked = fixture('hs-paid.html');
	const p = (text: string) => ({ type: 'paragraph', crumbs: [{ type: 'text', content: text }] });

	const denied = parseSanoma(locked, url, 'fi', { granted: false, reason: 'No session token provided' });
	assertLocked(denied, locked, 'pihalla vanhojen omenapuiden katveessa seisova Volvo');
	assert.equal(pick(denied.meta, 'subscriberCheck'), 'rejected');
	assert.equal(pick(denied.meta, 'subscriberReason'), 'No session token provided');

	const freePart = paragraphs(parseSanoma(locked, url, 'fi', { granted: true, splitBody: [] }));
	assert.ok(freePart.length > 0, 'fixture page carries the free opening');

	// The service returns only what follows the free part: appended.
	const continued = parseSanoma(locked, url, 'fi', { granted: true, splitBody: [p('Toinen osa.'), p('Kolmas osa.')] });
	assert.equal(continued.paywalled, false);
	assert.deepEqual(paragraphs(continued), [...freePart, 'Toinen osa.', 'Kolmas osa.']);
	assert.equal(pick(continued.meta, 'subscriberCheck'), 'ok');

	// The service returns the whole body: used as is, the opening appears once.
	const whole = parseSanoma(locked, url, 'fi', { granted: true, splitBody: [p(freePart[0]), p('Toinen osa.')] });
	assert.deepEqual(paragraphs(whole), [freePart[0], 'Toinen osa.']);
});

test('is: free article', () => {
	const a = parseSanoma(fixture('is-free.html'), 'https://www.is.fi/kotimaa/art-2000012310475.html', 'fi');
	assertWellFormed(a);
	assert.equal(a.title, 'Niklas aikoo metsästää suojeltua lajia – ”Kannat ovat nyt liian suuria”');
	const ps = paragraphs(a);
	assert.ok(ps.length >= 15);
	assert.match(ps[0], /^Merimetsoja saa nyt metsästää ilman erillistä poikkeuslupaa kohteissa/);
	assert.equal(a.images[0].caption, 'Merimetson metsästys on nyt sallittua syyskuusta helmikuuhun kalanpyydyksien läheisyydestä.');
	assert.equal(a.images[0].credit, 'Reijo Lehtonen');
	assert.equal(figures(a).length, 4);
});

test('is: paid article is paywalled and empty', () => {
	const html = fixture('is-paid.html');
	const a = parseSanoma(html, 'https://www.is.fi/perhe/art-2000012312345.html', 'fi');
	const shipped = /"crumbs":\[\{"marks":\[[^\]]*\],"attrs":\{\},"content":"([^"]{20,})"/.exec(html)?.[1];
	assert.ok(shipped, 'fixture has teaser paragraphs');
	assertLocked(a, html, shipped);
	assert.equal(a.title, 'Miksi äidin piti kuolla?');
});

test('iltalehti: window.App article with sentiment metadata', () => {
	const a = iltalehti(fixture('iltalehti-free.html'), 'https://www.iltalehti.fi/ralli/a/13f52db7-8a39-4c49-beb3-9a24dc8a1ede');
	assertWellFormed(a);
	assert.equal(a.title, 'Se oli siinä – Elfyn Evansilta raadollinen paljastus');
	assert.equal(a.lead, 'Walesilainen Elfyn Evans valloitti vihdoin rallin maailmanmestaruuden.');
	assert.equal(a.author, 'Aki Hietavala');
	const ps = paragraphs(a);
	assert.ok(ps.length >= 12);
	assert.match(ps[0], /^Elfyn Evans on kiertänyt MM-sarjaa pääluokassa jo kaudesta 2014 lähtien/);
	assert.ok(a.blocks.some((b) => b.type === 'h' && b.text === 'Perheet mukana'));
	assert.equal(a.images[0].caption, 'Elfyn Evans (oik.) ja kartanlukija Scott Martin juhlivat rallin maailmanmestaruutta.');
	assert.equal(a.images[0].credit, 'ZumaWire / MVPHOTOS');
	assert.deepEqual(pick(a.meta, 'sentiment'), ['Positive', 'Entertaining', 'Inspirational_Uplifting']);
});

test('iltalehti: paid article is paywalled even though the state ships its first paragraphs', () => {
	const html = fixture('iltalehti-paid.html');
	const a = iltalehti(html, 'https://www.iltalehti.fi/kotimaa/a/78693026-5836-4820-a304-320d6e253f47');
	assertLocked(a, html, 'Kukaan ei kuullut, kun mökin ovi avautui.');
	assert.equal(pick(a.meta, 'subscriptionLevel'), 'paid');
});

test('mtv: streamed body, video players and "Lue myös" removed, photo from the RSC payload', () => {
	const a = mtv(fixture('mtv-video-lead.html'), 'https://www.mtvuutiset.fi/artikkeli/elfyn-evansin-suuri-unelma-toteutui-viimein-dramaattinen-loppuratkaisu-loi-allikalla-en-voinut-uskoa/9402182');
	assertWellFormed(a);
	assert.equal(a.title, 'Elfyn Evansin suuri unelma toteutui viimein – dramaattinen loppuratkaisu löi ällikällä: "En voinut uskoa"');
	assert.equal(a.author, 'Riku Hellanto');
	const ps = paragraphs(a);
	assert.ok(ps.length >= 10);
	assert.equal(ps[0], 'Elfyn Evans kruunattiin ensimmäistä kertaa urallaan rallin maailmanmestariksi dramaattisten vaiheiden jälkeen.');
	assert.ok(ps.some((p) => p.endsWith('Latvala summaa.')), 'text from late-streamed segments');
	const text = blocksText(a.blocks);
	assert.ok(!text.includes('Lue myös'));
	assert.ok(!text.includes('Uskomaton päätös MM-rallikauteen'), 'video caption not in body');
	assert.equal(a.images[0].url, 'https://api.mtvuutiset.fi/graphql/caas/v1/media/9402184/data/ab22f2e45c9ef16ba47c5bdfb8322fb7/elfyn-evans.jpg');
	assert.equal(a.images[0].credit, 'TGR WRT/McKlein');
});

test('mtv: photo header with caption and credit', () => {
	const a = mtv(fixture('mtv-photo-lead.html'), 'https://www.mtvuutiset.fi/artikkeli/anni-ihamaki-ja-anssi-heikkila-eivat-tanssi-tanaan-ttk-ssa-ollut-aika-raju-viikko/9402074');
	assertWellFormed(a);
	assert.equal(paragraphs(a)[0], 'Anni Ihamäki ja Anssi Heikkilä jättävät tänä iltana väliin TTK:n suoran lähetyksen tanssit.');
	assert.ok(paragraphs(a).length >= 12);
	assert.equal(a.images[0].caption, 'Anni Ihamäen ja Anssi Heikkilän oli määrä tanssia cha cha cha TTK:n viidennessä suorassa lähetyksessä.');
	assert.equal(a.images[0].credit, 'Atte Kajova');
	assert.equal(a.images[0].url, 'https://api.mtvuutiset.fi/graphql/caas/v1/media/9376572/data/135e2348959533144b66681d727fd20f/1-06382714.jpg');
});

test('seiska: server-rendered article without ads, embeds or related teasers', () => {
	const a = seiska(fixture('seiska-free.html'), 'https://www.seiska.fi/kotimaa/tunnistaisitko-esko-eerikainen-julkaisi-lapsuuskuvia-kolumbiasta/2281297');
	assertWellFormed(a);
	assert.equal(a.title, 'Tunnistaisitko? Esko Eerikäinen julkaisi lapsuuskuvia Kolumbiasta!');
	assert.equal(a.lead, 'Esko vietti suurimman osan lapsuudestaan Kolumbiassa.');
	assert.equal(a.author, 'Silja Planting');
	assert.equal(a.publishedAt?.toISOString(), '2026-10-04T14:00:00.000Z');
	const ps = paragraphs(a);
	assert.ok(ps.length >= 15);
	assert.equal(ps[0], 'Radio Novan juontaja Esko Eerikäinen täyttää 53 vuotta 20. lokakuuta.');
	// Seiska does not caption its lead photos; the credit is there.
	assert.equal(a.images[0].credit, 'Atte Kajova');
	assert.match(a.images[0].url, /^https:\/\/image\.seiska\.fi\/2281310\.webp\?.*width=1440&height=811/);
	assert.equal(a.images[1].caption, 'Esko kilpailee tuoreella MTV:n Pirunpelin tuotantokaudella.');
	const text = blocksText(a.blocks);
	for (const leak of ['Katso myös', 'Mainos', 'View this post on Instagram', 'Suvi Hartlin ja Esko Eerikäinen kiehnäsivät']) assert.ok(!text.includes(leak), leak);
});

test('npr: lead photo, figures with captions and credits, no sponsor messages', () => {
	const a = npr(fixture('npr-free.html'), 'https://www.npr.org/2026/10/04/nx-s1-5990232/how-the-cornell-case-is-affecting-women-who-have-experienced-sexual-assault');
	assertWellFormed(a);
	assert.equal(a.title, 'How the Cornell case is affecting women who have experienced sexual assault');
	assert.equal(a.language, 'en');
	assert.equal(a.author, 'Windsor Johnston');
	const ps = paragraphs(a);
	assert.ok(ps.length >= 25);
	assert.match(ps[0], /^When Olivia Petter first saw the news about the sexual assault allegations at Cornell University/);
	assert.equal(a.images[0].caption, 'Olivia Petter, who says the Cornell University rape allegations have "triggered" her to recall her own experiences of sexual assault.');
	assert.equal(a.images[0].credit, 'Olivia Petter');
	assert.equal(figures(a).length, 2);
	assert.ok(a.images.every((i) => i.caption && i.credit));
	assert.ok(!blocksText(a.blocks).includes('Sponsor Message'));
});

test('normalizeUrl strips tracking parameters and fragments, keeps the rest', () => {
	assert.equal(normalizeUrl('https://yle.fi/a/74-20249674?origin=rss'), 'https://yle.fi/a/74-20249674');
	assert.equal(normalizeUrl('https://www.hs.fi/x/art-1.html?utm_source=rss&utm_medium=feed&id=7#top'), 'https://www.hs.fi/x/art-1.html?id=7');
	assert.equal(normalizeUrl('/a/1?at_medium=RSS&at_campaign=x', 'https://www.bbc.com/'), 'https://www.bbc.com/a/1');
});

test('ldFree reads booleans and the strings "True"/"False"', () => {
	assert.equal(ldFree(true), true);
	assert.equal(ldFree('False'), false);
	assert.equal(ldFree('true'), true);
	assert.equal(ldFree(undefined), undefined);
	assert.equal(ldFree('maybe'), undefined);
});

test('assignedState parses a JS object literal without evaluating it', () => {
	const html = '<script>window.App={"a":undefined,"b":"} undefined {","c":[NaN,-Infinity,{"d":"\\"}"}]};window.x=1</script>';
	assert.deepEqual(assignedState(html, 'window.App='), { a: null, b: '} undefined {', c: [null, null, { d: '"}' }] });
});

test('stripMarkdown removes links and emphasis only', () => {
	assert.equal(stripMarkdown('**Anna** sanoi [Supolle](https://supo.fi/x) *jotain* 2*3'), 'Anna sanoi Supolle jotain 2*3');
});

test('parseFeed reads RSS and Atom; parseNewsSitemap reads news entries', () => {
	const rss = '<rss version="2.0"><channel><item><title>Otsikko &amp; muuta</title><link>https://yle.fi/a/1?origin=rss</link><pubDate>Sun, 04 Oct 2026 19:56:55 +0300</pubDate><description><![CDATA[<p>Teaser</p>]]></description></item></channel></rss>';
	assert.deepEqual(parseFeed(rss, 'https://yle.fi/'), [{ url: 'https://yle.fi/a/1', title: 'Otsikko & muuta', publishedAt: new Date('2026-10-04T16:56:55Z'), teaser: 'Teaser' }]);
	const atom = '<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>A</title><link rel="alternate" href="https://x.example/a"/><updated>2026-10-04T10:00:00Z</updated></entry></feed>';
	assert.equal(parseFeed(atom, 'https://x.example/')[0].url, 'https://x.example/a');
	const sitemap = '<urlset xmlns:news="http://www.google.com/schemas/sitemap-news/0.9"><url><loc>https://www.hs.fi/a/art-1.html</loc><news:news><news:title>Uutinen</news:title><news:publication_date>2026-10-04T19:25:00.000+03:00</news:publication_date></news:news></url></urlset>';
	assert.deepEqual(parseNewsSitemap(sitemap, 'https://www.hs.fi/'), [{ url: 'https://www.hs.fi/a/art-1.html', title: 'Uutinen', publishedAt: new Date('2026-10-04T16:25:00Z') }]);
});

test('resolveReactStream moves streamed segments into their placeholders', () => {
	const html = '<div id="root"><p>a</p><template id="P:1"></template><!--$?--><template id="B:0"></template><p>loading</p><!--/$--></div><div hidden id="S:1"><p>b</p></div><div hidden id="S:0"><p>c</p></div><script>$RS("S:1","P:1");$RC("B:0","S:0")</script>';
	const doc = parseDoc(`<!doctype html><html><body>${html}</body></html>`);
	resolveReactStream(doc, html);
	assert.deepEqual([...doc.querySelectorAll('#root p')].map((p) => p.textContent), ['a', 'b', 'c']);
});

test('Body skips a body photo that repeats the lead, and promo paragraphs', () => {
	const body = new Body();
	body.lead({ url: 'https://x/1.jpg', caption: 'Lead' }, 'k1');
	body.p('Teksti.');
	body.figure({ url: 'https://x/1-big.jpg' }, 'k1');
	body.figure({ url: 'https://x/2.jpg', credit: 'Kuva: Jane Doe / Yle' });
	body.p('Lue myös: Toinen juttu');
	body.p('Tilaa IS:n uutiskirje tästä');
	const a = body.article({ title: 'Otsikko\u00ad' });
	assert.equal(a.title, 'Otsikko');
	assert.deepEqual(a.blocks, [{ type: 'p', text: 'Teksti.' }, { type: 'figure', image: 1 }]);
	assert.deepEqual(a.images, [{ position: 0, url: 'https://x/1.jpg', caption: 'Lead' }, { position: 1, url: 'https://x/2.jpg', credit: 'Jane Doe / Yle' }]);
});

test('outlet registry: unique slugs and sane defaults', () => {
	assert.equal(new Set(OUTLETS.map((o) => o.slug)).size, OUTLETS.length);
	assert.deepEqual(OUTLETS.map((o) => o.slug).sort(), ['hs', 'iltalehti', 'is', 'mtv', 'npr', 'seiska', 'yle']);
	for (const o of OUTLETS) {
		assert.ok(o.discoveryIntervalMin >= 10 && o.discoveryIntervalMin <= 20, o.slug);
		assert.match(o.homepage, /^https:\/\//);
	}
});

const url = process.env.DATABASE_URL;
const sql = url ? postgres(url, { max: 1, onnotice: () => {}, types: { bigint: BIGINT_AS_NUMBER } }) : null;

test('seedOutlets is idempotent and keeps admin changes to enabled and priority', { skip: !sql }, async () => {
	await sql!
		.begin(async (tx) => {
			const db = tx as unknown as postgres.Sql; // TransactionSql has the same tagged-template call surface
			await tx`INSERT INTO outlets (slug, name, language, homepage, enabled, priority) VALUES ('yle', 'Old name', 'fi', 'https://old.example', false, 5)
				ON CONFLICT (slug) DO UPDATE SET name = 'Old name', homepage = 'https://old.example', enabled = false, priority = 5`;
			await seedOutlets(db);
			await seedOutlets(db);
			const rows = await tx`SELECT slug, name, homepage, enabled, priority FROM outlets WHERE slug = ANY(${OUTLETS.map((o) => o.slug)}) ORDER BY slug`;
			assert.equal(rows.length, OUTLETS.length);
			const yleRow = rows.find((r) => r.slug === 'yle');
			assert.equal(yleRow?.name, 'Yle Uutiset');
			assert.equal(yleRow?.homepage, 'https://yle.fi/uutiset');
			assert.equal(yleRow?.enabled, false);
			assert.equal(yleRow?.priority, 5);
			throw new Error('rollback');
		})
		.catch((e: Error) => {
			if (e.message !== 'rollback') throw e;
		});
});

test.after(() => sql?.end());
