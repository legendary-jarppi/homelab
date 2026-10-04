// Yle Uutiset: RSS discovery; body from `window.__INITIAL__STATE__` (pageData.article.content[]).
// No paywall. Body text is Markdown.
import { z } from 'zod';
import { assignedState, Body, discoverFrom, fetchPage, parseDate, stripMarkdown, validate, type Article, type ImageInput } from './common.ts';
import { ExtractError, type OutletDef } from './types.ts';

const FEEDS = [
	'https://yle.fi/rss/uutiset/tuoreimmat',
	'https://yle.fi/rss/uutiset/paauutiset',
	'https://yle.fi/rss/t/18-34837/fi', // Kotimaa
	'https://yle.fi/rss/t/18-34953/fi', // Ulkomaat
	'https://yle.fi/rss/t/18-220306/fi', // Politiikka
	'https://yle.fi/rss/t/18-204933/fi' // Talous
];

const Str = z.string().nullish();
const Typed = z.looseObject({ type: z.string() });
const Image = z.looseObject({ type: z.literal('image'), id: z.string(), caption: Str, alt: Str, source: Str });
const Text = z.looseObject({ text: z.string(), level: z.number().nullish() });
const List = z.looseObject({ items: z.array(z.string()) });
const Quote = z.looseObject({ text: z.string(), source: Str });
const Aside = z.looseObject({ context: Str, content: z.array(Typed) });
const State = z.looseObject({
	pageId: Str,
	pageData: z
		.looseObject({
			article: z
				.looseObject({
					headline: z.looseObject({ full: z.string(), image: z.unknown().optional() }),
					lead: Str,
					datePublished: Str,
					language: Str,
					coverage: Str,
					mainMedia: z.array(Typed).nullish(),
					content: z.array(Typed),
					authors: z.array(z.looseObject({ name: Str, role: Str })).nullish(),
					subjects: z.array(z.looseObject({ title: z.looseObject({ fi: Str }).nullish() })).nullish()
				})
				.nullish()
		})
		.nullish()
});

function image(data: unknown): { img: ImageInput; id: string } | undefined {
	const parsed = Image.safeParse(data);
	if (!parsed.success) return undefined;
	const { id, caption, source, alt } = parsed.data;
	return { id, img: { url: `https://img.img-cdn.yle.fi/w_1440,f_jpg/${id}`, caption: stripMarkdown(caption ?? ''), credit: source ?? undefined, alt: alt ?? undefined } };
}

function addContent(body: Body, blocks: z.infer<typeof Typed>[]): void {
	for (const c of blocks) {
		switch (c.type) {
			case 'text':
				body.p(stripMarkdown(validate(Text, c, 'Yle text').text));
				break;
			case 'heading': {
				// Level 1 repeats the headline (or an alternate one) inside the body.
				const h = validate(Text, c, 'Yle heading');
				if (h.level !== 1) body.h(stripMarkdown(h.text));
				break;
			}
			case 'image': {
				const found = image(c);
				if (found) body.figure(found.img, found.id);
				break;
			}
			case 'bullet-list':
			case 'numbered-list':
				body.list(validate(List, c, 'Yle list').items.map(stripMarkdown), c.type === 'numbered-list');
				break;
			case 'quote': {
				const q = validate(Quote, c, 'Yle quote');
				body.quote(stripMarkdown(q.text), q.source ?? undefined);
				break;
			}
			case 'aside': {
				// The machine-written "Juttu tiivistettynä" duplicates the article; fact boxes are content.
				const aside = validate(Aside, c, 'Yle aside');
				if (aside.context !== 'ai_summary') addContent(body, aside.content);
				break;
			}
			// video, promo-content, links, form, embeds: not article text.
		}
	}
}

export function parseArticle(html: string, url: string): Article {
	const state = validate(State, assignedState(html, 'window.__INITIAL__STATE__='), 'Yle state');
	const article = state.pageData?.article;
	if (!article) throw new ExtractError(`not an article page (${state.pageId}): ${url}`, 'skipped');
	if (article.content.some((c) => /live|feed/.test(c.type))) throw new ExtractError('live coverage', 'skipped');

	const body = new Body();
	const main = article.mainMedia?.[0];
	const lead = image(main?.type === 'image' ? main : article.headline.image);
	if (lead) body.lead(lead.img, lead.id);
	const leadText = article.lead ? stripMarkdown(article.lead) : undefined;
	// The standfirst is usually repeated as the first text block.
	const firstText = article.content.find((c) => c.type === 'text');
	addContent(
		body,
		article.content.filter((c) => c !== firstText || Text.safeParse(c).data?.text.trim() !== article.lead?.trim())
	);

	const hasVideo = main?.type === 'video' || article.content.some((c) => c.type === 'video');
	if (hasVideo && body.textLength < 400) throw new ExtractError('video story', 'skipped');

	const authors = (article.authors ?? [])
		.filter((a) => a.name && !/kuva|video|grafiik|tuottaja|leikkaus|editointi/i.test(a.role ?? ''))
		.map((a) => a.name);
	return body.article({
		title: article.headline.full,
		lead: leadText,
		author: authors.length ? authors.join(', ') : undefined,
		publishedAt: parseDate(article.datePublished),
		language: article.language ?? 'fi',
		meta: {
			subjects: (article.subjects ?? []).map((s) => s.title?.fi).filter(Boolean).slice(0, 10),
			coverage: article.coverage
		}
	});
}

export const yle: OutletDef = {
	slug: 'yle',
	name: 'Yle Uutiset',
	language: 'fi',
	homepage: 'https://yle.fi/uutiset',
	priority: 80,
	enabledByDefault: true,
	discoveryIntervalMin: 10,
	discover: () =>
		discoverFrom(
			FEEDS.map((url) => ({ url, kind: 'rss' })),
			{ accept: (u) => u.hostname === 'yle.fi' && /^\/a\/\d+-\d+$/.test(u.pathname) }
		),
	async extract(url) {
		const page = await fetchPage(url);
		return parseArticle(page.html, page.url);
	}
};
