// MTV Uutiset: news sitemap + RSS discovery; body from the server-rendered HTML (Next.js app
// router with streamed segments). No text paywall. Most stories lead with a video; the article's
// own photo is then the JSON-LD/og image, whose credit sits in the RSC payload (`PictureImpl`).
import { z } from 'zod';
import {
	Body,
	cleanText,
	htmlText,
	discoverFrom,
	fetchPage,
	htmlBlocks,
	ldArticle,
	ldAuthor,
	parseDate,
	parseDoc,
	pick,
	resolveReactStream,
	type Article,
	type ImageInput
} from './common.ts';
import { ExtractError, type OutletDef } from './types.ts';

const HOST = 'www.mtvuutiset.fi';
const MEDIA = 'https://api.mtvuutiset.fi/graphql/caas/v1/media/';

const Picture = z.looseObject({ url: z.string(), alt: z.string().nullish(), copyright: z.string().nullish(), caption: z.string().nullish() });

/** Original rendition (2048 px) of a CAAS media URL: the crop/width path segments removed. */
function original(url: string): string {
	return url.replace(/\/(landscape|portrait|square)[^/]*\/\d+\//, '/');
}

/** `/_next/image?url=…` → the CAAS URL it wraps. */
function unwrapNextImage(src: string, base: string): string {
	const u = new URL(src, base);
	return u.pathname === '/_next/image' ? (u.searchParams.get('url') ?? u.toString()) : u.toString();
}

/** Metadata of media `id` from the escaped RSC payload (`{\"id\":\"9402184\",\"url\":…,\"__typename\":\"PictureImpl\"}`). */
function rscPicture(html: string, id: string): z.infer<typeof Picture> | undefined {
	const start = html.indexOf(`{\\"id\\":\\"${id}\\",\\"url\\":`);
	if (start < 0) return undefined;
	const end = html.indexOf('\\"PictureImpl\\"}', start);
	if (end < 0 || end - start > 4000) return undefined;
	try {
		const parsed = Picture.safeParse(JSON.parse(JSON.parse(`"${html.slice(start, end + '\\"PictureImpl\\"}'.length)}"`)));
		return parsed.success ? parsed.data : undefined;
	} catch {
		return undefined;
	}
}

function figure(el: Element, base: string): ImageInput | null {
	if (el.querySelector('[data-testid^=web-player], [data-testid^=video]')) return null;
	const img = el.querySelector('img');
	const src = img?.getAttribute('src');
	if (!src) return null;
	const url = unwrapNextImage(src, base);
	if (!url.startsWith(MEDIA)) return null;
	return {
		url: original(url),
		caption: cleanText(el.querySelector('[data-testid=caption]')?.textContent),
		credit: cleanText(el.querySelector('[data-testid=copyright]')?.textContent),
		alt: img?.getAttribute('alt') ?? undefined
	};
}

export function parseArticle(html: string, url: string): Article {
	const doc = parseDoc(html);
	resolveReactStream(doc, html);
	const ld = ldArticle(doc);
	const texts = [...doc.querySelectorAll('[data-testid=article-text-component]')];
	const title = htmlText(String(pick(ld, 'headline') ?? doc.querySelector('h1')?.textContent ?? ''));
	// Live follows keep their URL slug ("…-mtv-seuraa", "suora-lahetys-…") when the headline changes.
	if (/^(suora lähetys|seuranta|live)\b/i.test(title) || /(^|-)(mtv-seuraa|seuranta|suora-lahetys|live)(-|$)/.test(new URL(url).pathname.split('/').at(-2) ?? '')) {
		throw new ExtractError('live coverage', 'skipped');
	}
	if (!texts.length) throw new ExtractError(`no article text on page: ${url}`);

	const body = new Body();
	const header = doc.querySelector('[data-testid=header-media-component]');
	const headerImage = header && !header.querySelector('[data-testid^=header-media-video]') ? figure(header, url) : null;
	if (headerImage) body.lead(headerImage);
	else {
		// Video header: the article's own photo is the share image.
		const share = String(pick(ld, 'image', 'url') ?? doc.querySelector('meta[property="og:image"]')?.getAttribute('content') ?? '');
		const id = /\/media\/share\/(\d+)\//.exec(share)?.[1];
		const pic = id ? rscPicture(html, id) : undefined;
		if (pic) body.lead({ url: pic.url, caption: pic.caption ?? undefined, credit: pic.copyright ?? undefined, alt: pic.alt ?? undefined });
		else if (share.startsWith(MEDIA)) body.lead({ url: share });
	}

	for (const root of texts) {
		// Video players render inside paragraphs, with the clip title as a caption.
		for (const player of root.querySelectorAll('[data-testid=web-player-broker]')) (player.closest('p') ?? player).remove();
		htmlBlocks(root, body, { drop: ['.sonia-container', '[data-testid=topics]'], figure: (el) => figure(el, url) });
	}
	if (header?.querySelector('[data-testid^=header-media-video]') && body.textLength < 400) throw new ExtractError('video story', 'skipped');

	return body.article({
		title,
		author: ldAuthor(pick(ld, 'author')),
		publishedAt: parseDate(pick(ld, 'datePublished')),
		language: 'fi',
		// Sub-brands live under their own path (/makuja/artikkeli/…); news is /artikkeli/….
		meta: { section: /^\/([\w-]+)\/artikkeli\//.exec(new URL(url).pathname)?.[1] }
	});
}

export const mtv: OutletDef = {
	slug: 'mtv',
	name: 'MTV Uutiset',
	language: 'fi',
	homepage: 'https://www.mtvuutiset.fi/',
	priority: 60,
	enabledByDefault: true,
	discoveryIntervalMin: 15,
	discover: () =>
		discoverFrom(
			[
				{ url: `https://${HOST}/newssitemap`, kind: 'sitemap' },
				{ url: `https://${HOST}/api/feed/rss/uutiset_uusimmat`, kind: 'rss' }
			],
			{ accept: (u) => u.hostname === HOST && /\/artikkeli\/[^/]+\/\d+$/.test(u.pathname) }
		),
	async extract(url) {
		const page = await fetchPage(url);
		return parseArticle(page.html, page.url);
	}
};
