// NPR (English): news sitemap + RSS discovery; body from the server-rendered `#storytext`.
// No paywall. robots.txt forbids query strings, so article URLs are fetched without them.
import { Body, cleanText, discoverFrom, fetchPage, htmlBlocks, ldArticle, ldAuthor, parseDate, parseDoc, pick, type Article, type ImageInput } from './common.ts';
import { ExtractError, type OutletDef } from './types.ts';

const HOST = 'www.npr.org';
const STORY_PATH = /^\/(sections\/[\w-]+\/)?\d{4}\/\d{2}\/\d{2}\/[\w-]+\/[\w-]+$/;

/** `.bucketwrap.image` → photo at 1600 px from the CDN's own URL template. */
function photo(el: Element, base: string): ImageInput | null {
	const template = el.querySelector('source[data-template]')?.getAttribute('data-template');
	const src = el.querySelector('img')?.getAttribute('src');
	// Never ask for more pixels than the crop has.
	const width = String(Math.min(1600, Number(/\/crop\/(\d+)x/.exec(template ?? src ?? '')?.[1] ?? 1600)));
	const url = template
		? template.replace('{width}', width).replace('{quality}', '85').replace('{format}', 'jpeg')
		: src?.replace(/\/resize\/\d+(x\d+!?)?\//, `/resize/${width}/`);
	if (!url) return null;
	const credit = cleanText(el.querySelector('span.credit, .credit')?.textContent);
	const caption = el.querySelector('.caption p');
	for (const extra of caption?.querySelectorAll('.credit, .hide-caption') ?? []) extra.remove();
	return {
		url: new URL(url, base).toString(),
		caption: cleanText(caption?.textContent),
		credit,
		alt: el.querySelector('img')?.getAttribute('alt') ?? undefined
	};
}

export function parseArticle(html: string, url: string): Article {
	const doc = parseDoc(html);
	const ld = ldArticle(doc);
	const story = doc.querySelector('#storytext');
	const title = cleanText(doc.querySelector('.storytitle h1')?.textContent) || String(pick(ld, 'headline') ?? '');
	if (/\b(sunday puzzle|quiz)\b/i.test(title)) throw new ExtractError('puzzle or quiz', 'skipped');
	if (!story) throw new ExtractError(`no #storytext on page: ${url}`);

	const body = new Body();
	// A photo before the first paragraph is the lead image.
	const first = story.firstElementChild;
	if (first?.matches('.bucketwrap.image')) {
		body.lead(photo(first, url));
		first.remove();
	}
	htmlBlocks(story, body, {
		drop: ['.bucketwrap:not(.image)', '.ad-wrap', '[id*="callout"]', '[class*="recommend"]', '.enlarge_measure', '.enlarge_html'],
		figures: '.bucketwrap.image',
		figure: (el) => photo(el, url)
	});
	// Radio pieces and podcast episodes carry a summary paragraph or two (plus a broadcast
	// transcript), not an article.
	if (body.paragraphs < 3 && doc.querySelector('#headlineaudio, .transcript, .podcast-episode')) throw new ExtractError('radio or podcast piece', 'skipped');
	if (body.textLength < 300) throw new ExtractError('no article text', 'skipped');

	const slug = cleanText(doc.querySelector('.slug-wrap .slug')?.textContent);
	return body.article({
		title,
		author: ldAuthor(pick(ld, 'author')) ?? (cleanText(doc.querySelector('#storybyline .byline__name')?.textContent) || undefined),
		publishedAt: parseDate(pick(ld, 'datePublished')),
		language: 'en',
		meta: { section: slug || undefined }
	});
}

export const npr: OutletDef = {
	slug: 'npr',
	name: 'NPR',
	language: 'en',
	homepage: 'https://www.npr.org/',
	priority: 50,
	enabledByDefault: true,
	discoveryIntervalMin: 20,
	discover: () =>
		discoverFrom(
			[
				{ url: 'https://googlecrawl.npr.org/news/sitemap_news.xml', kind: 'sitemap' },
				{ url: 'https://feeds.npr.org/1001/rss.xml', kind: 'rss' },
				{ url: 'https://feeds.npr.org/1004/rss.xml', kind: 'rss' }
			],
			{ accept: (u) => u.hostname === HOST && !u.search && STORY_PATH.test(u.pathname) }
		),
	async extract(url) {
		const clean = new URL(url);
		clean.search = '';
		const page = await fetchPage(clean.toString());
		return parseArticle(page.html, page.url);
	}
};
