// Sanoma platform (Helsingin Sanomat, Ilta-Sanomat): news sitemap + RSS discovery; body from
// `__NEXT_DATA__` props.pageProps.page.assetData.splitBody. The lock flags (`showPaywall`,
// `paidType`, JSON-LD isAccessibleForFree) decide; a locked article's body is never read.
// With a subscriber session (COOKIES_<SLUG>, sessions.ts) the server computes `showPaywall` for
// that subscriber, so it alone decides; JSON-LD keeps describing anonymous access.
import { z } from 'zod';
import { sessionFor } from '../sessions.ts';
import { Body, discoverFrom, fetchPage, ldArticle, ldFree, nextData, paywalled, parseDate, parseDoc, pick, validate, type Article, type ImageInput } from './common.ts';
import { ExtractError, type Discovered } from './types.ts';

const Str = z.string().nullish();
const Typed = z.looseObject({ type: z.string() });
const Crumbs = z.array(z.looseObject({ type: Str, content: Str, marks: z.array(z.string()).nullish() }));
const Paragraph = z.looseObject({ crumbs: Crumbs });
const Heading = z.looseObject({ content: z.string() });
const Picture = z.looseObject({ url: z.string(), caption: Str, photographer: Str });
const Img = z.looseObject({ img: Picture });
const Blockquote = z.looseObject({ body: z.array(z.looseObject({ crumbs: Crumbs.nullish() })) });
const List = z.looseObject({ listContent: z.array(z.looseObject({ crumbs: Crumbs.nullish() })), listType: Str });
const Factbox = z.looseObject({ body: z.array(Typed) });
const Contributors = z.looseObject({ contributors: z.array(z.looseObject({ crumbs: Crumbs.nullish() })) });
const Page = z.looseObject({
	props: z.looseObject({
		pageProps: z.looseObject({
			page: z
				.looseObject({
					assetData: z
						.looseObject({
							title: z.string(),
							ingress: Str,
							displayDate: Str,
							resourceType: Str,
							paidType: Str,
							showPaywall: z.boolean().nullish(),
							mainPicture: Picture.nullish(),
							mainVideo: z.unknown().optional(),
							splitBody: z.array(Typed).nullish(),
							authors: z.array(z.looseObject({ title: Str, firstName: Str, lastName: Str })).nullish(),
							analyticsMetadataV2: z.looseObject({ page_category: Str }).nullish(),
							tags: z.array(z.looseObject({ title: Str })).nullish(),
							editorialUserNeed: z.array(z.string()).nullish()
						})
						.nullish()
				})
				.nullish()
		})
	})
});

/** `…/normal/WIDTH.EXT` → a width from the CDN's fixed ladder (1440 is on it, 1600 is not). */
function picture(p: z.infer<typeof Picture>): ImageInput {
	return { url: p.url.replace('WIDTH.EXT', '1440.jpg'), caption: p.caption ?? undefined, credit: p.photographer ?? undefined };
}

function crumbText(crumbs: z.infer<typeof Crumbs> | null | undefined): string {
	return (crumbs ?? []).map((c) => c.content ?? '').join('');
}

function addBody(body: Body, blocks: z.infer<typeof Typed>[]): void {
	for (const b of blocks) {
		switch (b.type) {
			case 'paragraph': {
				const { crumbs } = validate(Paragraph, b, 'Sanoma paragraph');
				// A paragraph of only `location` crumbs is the dateline ("Viiala"), shown above the text.
				if (crumbs.every((c) => c.marks?.includes('location'))) break;
				// Endnotes with links are the section's submission instructions; corrections stay.
				if (crumbs.some((c) => c.marks?.includes('endnote')) && crumbs.some((c) => /Link$/.test(c.type ?? ''))) break;
				body.p(crumbText(crumbs));
				break;
			}
			case 'heading':
				body.h(validate(Heading, b, 'Sanoma heading').content);
				break;
			case 'img': {
				const { img } = validate(Img, b, 'Sanoma image');
				body.figure(picture(img), img.url);
				break;
			}
			case 'blockquote':
				body.quote(validate(Blockquote, b, 'Sanoma blockquote').body.map((p) => crumbText(p.crumbs)).join(' '));
				break;
			case 'list': {
				const list = validate(List, b, 'Sanoma list');
				body.list(list.listContent.map((i) => crumbText(i.crumbs)), list.listType === 'ol');
				break;
			}
			case 'factbox':
				addBody(body, validate(Factbox, b, 'Sanoma factbox').body);
				break;
			case 'contributors':
				// Signature of a letter or guest column: "Name, title, town".
				body.p(validate(Contributors, b, 'Sanoma contributors').contributors.map((c) => crumbText(c.crumbs)).join(', '));
				break;
			// citation (pull quote repeating the text), summary (bullet recap), livearticle and iframe
			// embeds and articleadplaceholder are not article text.
		}
	}
}

/**
 * `authenticated`: the page was fetched with a subscriber session. Paid articles then carry
 * `meta.subscriberCheck` ('ok' = opened, 'rejected' = still locked: the session no longer works).
 */
export function parseSanoma(html: string, url: string, language: string, authenticated = false): Article {
	const page = validate(Page, nextData(html), 'Sanoma page').props.pageProps.page;
	const a = page?.assetData;
	if (!a) throw new ExtractError(`not an article page: ${url}`, 'skipped');
	if (a.resourceType && a.resourceType !== 'Article') throw new ExtractError(`resource type ${a.resourceType}`, 'skipped');
	if (new URL(url).pathname.startsWith('/pelit/')) throw new ExtractError('puzzle page', 'skipped');

	const ld = ldArticle(parseDoc(html));
	const authors = (a.authors ?? [])
		.map((p) => (p.firstName && p.lastName && p.firstName !== p.lastName ? `${p.firstName} ${p.lastName}` : (p.title ?? '')))
		.filter(Boolean);
	const fields = {
		title: a.title,
		lead: a.ingress ?? undefined,
		author: authors.length ? authors.join(', ') : undefined,
		publishedAt: parseDate(a.displayDate),
		language,
		meta: {
			section: a.analyticsMetadataV2?.page_category ?? undefined,
			paidType: a.paidType,
			tags: (a.tags ?? []).map((t) => t.title).filter(Boolean),
			userNeed: a.editorialUserNeed ?? undefined
		} as Record<string, unknown>
	};
	// Missing flags count as locked: only an explicit "no paywall" opens the body.
	const anonymousOpen = a.showPaywall === false && (a.paidType === 'free' || a.paidType === 'metered') && ldFree(pick(ld, 'isAccessibleForFree')) !== false;
	const open = authenticated ? a.showPaywall === false : anonymousOpen;
	if (authenticated && a.paidType === 'paid') fields.meta.subscriberCheck = open ? 'ok' : 'rejected';
	if (!open) return paywalled(fields);

	const blocks = a.splitBody ?? [];
	const body = new Body();
	if (a.mainPicture) body.lead(picture(a.mainPicture), a.mainPicture.url);
	addBody(body, blocks);
	const text = body.blocks.map((b) => ('text' in b ? b.text : '')).join('\n');
	if (blocks.some((b) => b.type === 'livearticle') && (body.textLength < 800 || /^Seuranta\b/.test(text))) throw new ExtractError('live coverage', 'skipped');
	if (blocks.some((b) => b.type === 'iframe') && /^Jos (testi|visa|kysely|tehtävä) ei näy/im.test(text)) throw new ExtractError('quiz', 'skipped');
	if (a.mainVideo && body.textLength < 400) throw new ExtractError('video story', 'skipped');
	return body.article(fields);
}

export async function extractSanoma(url: string, language: string, slug: string): Promise<Article> {
	const session = sessionFor(slug) ?? undefined;
	const page = await fetchPage(url, session);
	return parseSanoma(page.html, page.url, language, session !== undefined);
}

/** Sitemap first: its titles lack the RSS "Section | " prefix. */
export function discoverSanoma(host: string): Promise<Discovered[]> {
	return discoverFrom(
		[
			{ url: `https://${host}/rss/custom/news-sitemap.xml`, kind: 'sitemap' },
			{ url: `https://${host}/rss/tuoreimmat.xml`, kind: 'rss' }
		],
		// /pelit/ holds daily puzzles (crosswords, sudoku), not articles.
		{ accept: (u) => u.hostname === host && !u.pathname.startsWith('/pelit/') && /\/art-\d+\.html$/.test(u.pathname) }
	);
}
