// Iltalehti: discovery from the site's own "latest" listing API plus RSS; body from the page's
// `window.App` state (state.articles[<uuid>].items). Locked when `subscription_level` is set, the
// article is a plus article, or the body carries a login wall.
import { z } from 'zod';
import { getText } from '../http.ts';
import { Body, discoverFrom, fetchPage, assignedState, mergeDiscovered, normalizeUrl, paywalled, parseDate, validate, type Article, type ImageInput } from './common.ts';
import { ExtractError, type Discovered, type OutletDef } from './types.ts';

const HOST = 'www.iltalehti.fi';
const LATEST_API = 'https://api.il.fi/v1/articles/iltalehti/lists/latest?limit=100';
const LIST_IMAGE = 'Artikkelin listakuva';

const Str = z.string().nullish();
const Typed = z.looseObject({ type: z.string() });
const Urls = z.record(z.string(), z.string());
const ImageMeta = z.looseObject({ image_name: z.string(), caption: Str, source: Str, urls: Urls.nullish() });
const BodyImage = z.looseObject({ image_name: z.string(), urls: Urls.nullish(), properties: z.looseObject({ caption: Str, source: Str }).nullish() });
interface Inline {
	text?: string | null;
	items?: Inline[] | null;
}
const Inline: z.ZodType<Inline> = z.looseObject({ text: Str, get items() { return z.array(Inline).nullish(); } });
const Paragraph = z.looseObject({ items: z.array(Inline) });
const Subheadline = z.looseObject({ text: z.string() });
const Scrollytell = z.looseObject({ media: z.array(z.unknown()).nullish(), texts: z.array(z.looseObject({ text: Str })).nullish() });
const Category = z.looseObject({ category_name: z.string(), description: Str, parent_category: z.looseObject({ category_name: z.string() }).nullish() });
const Item = z.looseObject({
	article_id: z.string(),
	title: z.string(),
	headline: Str,
	lead: Str,
	published_at: Str,
	subscription_level: Str,
	functional_keywords: z.array(z.string()).nullish(),
	body: z.array(Typed),
	images: z.array(ImageMeta).nullish(),
	main_media: z.looseObject({ type: z.string(), image_name: Str }).nullish(),
	main_image_name: Str,
	authors: z.array(z.looseObject({ name: Str })).nullish(),
	category: Category.nullish(),
	metadata: z.looseObject({ sentiment: z.array(z.string()).nullish(), longform: z.boolean().nullish(), sponsored_content: z.unknown().optional(), article_type: Str }).nullish()
});
const State = z.looseObject({ state: z.looseObject({ articles: z.record(z.string(), z.looseObject({ items: z.unknown().optional() })).nullish() }) });
const Latest = z.looseObject({
	response: z.array(
		z.looseObject({
			article_id: z.string(),
			title: z.string(),
			lead: Str,
			published_at: Str,
			category: z.looseObject({ category_name: z.string() }).nullish(),
			metadata: z.looseObject({ canonical_url: Str }).nullish()
		})
	)
});

function inlineText(items: Inline[] | null | undefined): string {
	return (items ?? []).map((i) => (i.text ?? '') + inlineText(i.items)).join('');
}

/** The largest rendition the outlet already signed (Thumbor URLs cannot be resized by us). */
function bestUrl(urls: Record<string, string> | null | undefined): string | undefined {
	return urls ? (urls.gallery ?? urls.size1024 ?? urls.default) : undefined;
}

export function parseArticle(html: string, url: string): Article {
	const uuid = /\/a\/([0-9a-f-]{36})/.exec(new URL(url).pathname)?.[1];
	const articles = validate(State, assignedState(html, 'window.App='), 'Iltalehti state').state.articles ?? {};
	const entry = (uuid && articles[uuid]) || Object.values(articles)[0];
	if (!entry?.items) throw new ExtractError(`no article in page state: ${url}`, 'skipped');
	const it = validate(Item, entry.items, 'Iltalehti article');
	const keywords = it.functional_keywords ?? [];

	const fields = {
		title: it.title,
		lead: it.lead ?? undefined,
		author: (it.authors ?? []).map((a) => a.name).filter(Boolean).join(', ') || undefined,
		publishedAt: parseDate(it.published_at),
		language: 'fi',
		meta: {
			headline: it.headline ?? undefined,
			section: it.category?.parent_category?.category_name ?? it.category?.category_name,
			category: it.category?.category_name,
			sentiment: it.metadata?.sentiment ?? undefined,
			longform: it.metadata?.longform ?? undefined,
			sponsored: it.metadata?.sponsored_content ? true : undefined,
			subscriptionLevel: it.subscription_level ?? undefined
		}
	};
	if (keywords.includes('testit')) throw new ExtractError('quiz', 'skipped');
	if (/live/i.test(it.metadata?.article_type ?? '') || keywords.some((k) => /live/i.test(k))) throw new ExtractError('live coverage', 'skipped');
	const locked =
		it.subscription_level != null || keywords.some((k) => k.startsWith('plus_article')) || it.body.some((b) => b.type.includes('login-wall') || b.type.includes('paywall'));
	if (locked) return paywalled(fields);

	// The list thumbnail repeats a photo under the placeholder caption "Artikkelin listakuva".
	const meta = new Map<string, z.infer<typeof ImageMeta>>();
	for (const i of it.images ?? []) if (i.caption !== LIST_IMAGE || !meta.has(i.image_name)) meta.set(i.image_name, i);
	const image = (data: unknown): { img: ImageInput; key: string } | undefined => {
		const parsed = BodyImage.safeParse(data);
		if (!parsed.success) return undefined;
		const b = parsed.data;
		const m = meta.get(b.image_name);
		const src = bestUrl(b.urls) ?? bestUrl(m?.urls);
		if (!src) return undefined;
		const caption = m?.caption || b.properties?.caption;
		return { key: b.image_name, img: { url: src, caption: caption === LIST_IMAGE ? undefined : (caption ?? undefined), credit: m?.source ?? b.properties?.source ?? undefined } };
	};

	const body = new Body();
	const main = it.main_media?.type === 'image' ? image(it.main_media) : it.main_image_name ? image({ image_name: it.main_image_name }) : undefined;
	if (main) body.lead(main.img, main.key);
	for (const b of it.body) {
		switch (b.type) {
			case 'paragraph':
				body.p(inlineText(validate(Paragraph, b, 'Iltalehti paragraph').items));
				break;
			case 'subheadline':
				body.h(validate(Subheadline, b, 'Iltalehti subheadline').text);
				break;
			case 'image': {
				const found = image(b);
				if (found) body.figure(found.img, found.key);
				break;
			}
			case 'scrollytell': {
				const s = validate(Scrollytell, b, 'Iltalehti scrollytell');
				for (const m of s.media ?? []) {
					const found = image(m);
					if (found) body.figure(found.img, found.key);
				}
				for (const t of s.texts ?? []) body.p(t.text);
				break;
			}
			// advertisement, related-article, embed (video), image-ext (banners), alma-embed and
			// alma-tunnus-embed (widgets, polls), divider: not article content.
		}
	}
	if (it.main_media?.type === 'embed' && body.textLength < 400) throw new ExtractError('video story', 'skipped');
	return body.article(fields);
}

async function latestApi(): Promise<Discovered[]> {
	const { text } = await getText(LATEST_API, { accept: 'application/json' });
	const out: Discovered[] = [];
	for (const item of validate(Latest, JSON.parse(text), 'Iltalehti latest list').response) {
		const fallback = item.category ? `https://${HOST}/${item.category.category_name}/a/${item.article_id}` : undefined;
		const url = item.metadata?.canonical_url || fallback;
		if (!url) continue;
		out.push({ url: normalizeUrl(url), title: item.title, publishedAt: parseDate(item.published_at), teaser: item.lead ?? undefined });
	}
	return out;
}

// "Palat" are short vertical-video cards, not articles.
const isArticleUrl = (u: URL) => u.hostname === HOST && !u.pathname.startsWith('/palat/') && /^\/[\w-]+\/a\/[0-9a-f-]{36}$/.test(u.pathname);

export const iltalehti: OutletDef = {
	slug: 'iltalehti',
	name: 'Iltalehti',
	language: 'fi',
	homepage: 'https://www.iltalehti.fi/',
	priority: 60,
	enabledByDefault: true,
	discoveryIntervalMin: 15,
	async discover() {
		const [api, rss] = await Promise.allSettled([latestApi(), discoverFrom([{ url: `https://${HOST}/rss.xml`, kind: 'rss' }], { accept: isArticleUrl })]);
		if (api.status === 'rejected' && rss.status === 'rejected') throw new Error(`all discovery sources failed: ${String(api.reason)}; ${String(rss.reason)}`);
		if (api.status === 'rejected') console.warn(`discovery source failed: ${LATEST_API}: ${String(api.reason)}`);
		return mergeDiscovered([api.status === 'fulfilled' ? api.value : [], rss.status === 'fulfilled' ? rss.value : []], { accept: isArticleUrl });
	},
	async extract(url) {
		const page = await fetchPage(url);
		return parseArticle(page.html, page.url);
	}
};
