// Seiska: `latest.rss` discovery (no dates; the article's JSON-LD has them); body from the
// server-rendered `<article id="article-body">`. Paywall from JSON-LD and the dataLayer flag.
import { Body, cleanText, discoverFrom, fetchPage, htmlBlocks, ldArticle, ldAuthor, ldFree, paywalled, parseDate, parseDoc, pick, type Article, type ImageInput } from './common.ts';
import { ExtractError, type OutletDef } from './types.ts';

const HOST = 'www.seiska.fi';
const WIDTH = 1440;

/** The CDN renders any size: ask for 1440 px wide, same crop and aspect. */
function resized(src: string, base: string): string {
	const u = new URL(src, base);
	const w = Number(u.searchParams.get('width'));
	const h = Number(u.searchParams.get('height'));
	u.searchParams.set('width', String(WIDTH));
	if (w > 0 && h > 0) u.searchParams.set('height', String(Math.round((h * WIDTH) / w)));
	else u.searchParams.delete('height');
	u.searchParams.set('format', 'jpg');
	u.searchParams.set('compression', '80');
	return u.toString();
}

function image(img: Element | null, captionScope: Element | null, base: string): ImageInput | null {
	const src = img?.getAttribute('src');
	if (!src || !/(^|\.)image\.seiska\.fi$/.test(new URL(src, base).hostname)) return null;
	return {
		url: resized(src, base),
		caption: cleanText(captionScope?.querySelector('figcaption[itemprop=caption]')?.textContent),
		credit: cleanText(captionScope?.querySelector('figcaption[itemprop=author]')?.textContent),
		alt: img?.getAttribute('alt') ?? undefined
	};
}

export function parseArticle(html: string, url: string): Article {
	const doc = parseDoc(html);
	const ld = ldArticle(doc);
	const root = doc.querySelector('article#article-body');
	const text = root?.querySelector('.bodytext');
	if (!root || !text) throw new ExtractError(`no article body on page: ${url}`);
	const header = root.querySelector('.articleHeader');

	const fields = {
		title: cleanText(header?.querySelector('h1')?.textContent) || String(pick(ld, 'headline') ?? ''),
		lead: cleanText(header?.querySelector('p.subtitle')?.textContent) || undefined,
		author: ldAuthor(pick(ld, 'author')),
		publishedAt: parseDate(pick(ld, 'datePublished')),
		language: 'fi',
		meta: { section: pick(ld, 'articleSection') }
	};
	if (ldFree(pick(ld, 'isAccessibleForFree')) === false || /"is_paywall"\s*:\s*true/.test(html)) return paywalled(fields);

	const body = new Body();
	body.lead(image(header?.querySelector('figure.headerImage img') ?? null, header?.querySelector(':scope > .caption') ?? null, url));
	htmlBlocks(text, body, {
		// Ads, video players, social embeds and related-article teasers (nested <article>s).
		drop: ['.ad-slot-container', '.jwplayer', '.markupbox', 'article', '[class*="newsletter"]'],
		figure: (el) => image(el.querySelector('img'), el, url)
	});
	if (body.textLength < 300 && /jwplayer|gallery|galleria/i.test(text.innerHTML)) throw new ExtractError('video or gallery without text', 'skipped');
	return body.article(fields);
}

export const seiska: OutletDef = {
	slug: 'seiska',
	name: 'Seiska',
	language: 'fi',
	homepage: 'https://www.seiska.fi/',
	priority: 30,
	enabledByDefault: true,
	discoveryIntervalMin: 20,
	discover: () =>
		discoverFrom([{ url: `https://${HOST}/latest.rss`, kind: 'rss' }], { accept: (u) => u.hostname === HOST && /\/\d+$/.test(u.pathname) }),
	async extract(url) {
		const page = await fetchPage(url);
		return parseArticle(page.html, page.url);
	}
};
