// Shared helpers for outlet modules: feeds and news sitemaps, JSON-LD, embedded state blobs,
// URL normalisation, text cleanup and HTML → Block conversion.
import { XMLParser } from 'fast-xml-parser';
import { parseHTML } from 'linkedom';
import type { z } from 'zod';
import type { Block, ExtractedArticle, ExtractedImage } from '../blocks.ts';
import { getText } from '../http.ts';
import { ExtractError, type Discovered } from './types.ts';

export type Article = ExtractedArticle & { meta?: Record<string, unknown> };

// ---------------------------------------------------------------- text

/** Collapses whitespace and drops soft hyphens and zero-width characters. */
export function cleanText(s: string | null | undefined): string {
	if (!s) return '';
	return s
		.replace(/[\u00ad\u200b-\u200d\u2060\ufeff]/g, '')
		.replace(/[\s\u00a0\u202f]+/g, ' ')
		.trim();
}

/** Text content of an HTML fragment (entities decoded, tags removed), cleaned. */
export function htmlText(html: string | null | undefined): string {
	if (!html) return '';
	if (!/[<&]/.test(html)) return cleanText(html);
	return cleanText(parseDoc(`<!doctype html><html><body>${html}</body></html>`).body.textContent);
}

/** Removes Markdown links and emphasis (Yle writes body text in Markdown). */
export function stripMarkdown(s: string): string {
	return s
		.replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
		.replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, '$2')
		.replace(/(^|[^\w*])\*(?=\S)([^*]*?\S)\*(?!\w)/g, '$1$2')
		.replace(/(^|[^\w_])_(?=\S)([^_]*?\S)_(?!\w)/g, '$1$2')
		.replace(/\\([\\`*_{}[\]()#+\-.!>])/g, '$1');
}

/** "Kuva: Jane Doe / Yle" → "Jane Doe / Yle". */
export function cleanCredit(s: string | null | undefined): string | undefined {
	const text = cleanText(s)
		.replace(/^\(?\s*(kuva|kuvat|kuvaaja|photo|photograph|image credit|image|credit|foto|(worldwide )?copyright)\s*:\s*/i, '')
		.replace(/^\(([^()]*)\)$/, '$1')
		.replace(/^[\s/|–-]+|[\s/|–-]+$/g, '')
		.trim();
	return text || undefined;
}

export function parseDate(v: unknown): Date | undefined {
	if (typeof v !== 'string' && typeof v !== 'number') return undefined;
	const d = new Date(typeof v === 'string' ? v.trim().replace(/([+-]\d\d)(\d\d)$/, '$1:$2') : v);
	return Number.isNaN(d.getTime()) ? undefined : d;
}

// ---------------------------------------------------------------- URLs

const TRACKING_PARAM = /^(utm_.*|at_.*|origin|fbclid|gclid|dclid|msclkid|mc_cid|mc_eid|igshid|ref|ref_src|cmpid|_ga)$/i;

/** Absolute URL without fragment and tracking parameters; host and path untouched. */
export function normalizeUrl(raw: string, base?: string): string {
	const url = new URL(raw.trim(), base);
	url.hash = '';
	for (const key of [...url.searchParams.keys()]) if (TRACKING_PARAM.test(key)) url.searchParams.delete(key);
	return url.toString();
}

// ---------------------------------------------------------------- feeds and sitemaps

const xml = new XMLParser({
	ignoreAttributes: false,
	attributeNamePrefix: '@',
	htmlEntities: true,
	parseTagValue: false,
	parseAttributeValue: false,
	processEntities: { enabled: true, maxTotalExpansions: 1_000_000, maxExpandedLength: 50_000_000 },
	isArray: (name) => ['item', 'entry', 'url', 'link'].includes(name)
});

function asArray<T>(v: T | T[] | undefined | null): T[] {
	return v == null ? [] : Array.isArray(v) ? v : [v];
}

/** Nested property of parsed external data (XML, JSON-LD); undefined when a step is missing. */
export function pick(v: unknown, ...path: string[]): unknown {
	let cur = v;
	for (const key of path) {
		if (!cur || typeof cur !== 'object' || !(key in cur)) return undefined;
		cur = Reflect.get(cur, key);
	}
	return cur;
}

/** Text of a parsed XML node: plain string, `#text`, or the first of several. */
function nodeText(v: unknown): string {
	if (v == null) return '';
	if (Array.isArray(v)) return nodeText(v[0]);
	if (typeof v === 'object') return nodeText(pick(v, '#text'));
	return String(v);
}

/** Items of an RSS 2.0, RSS 1.0 (RDF) or Atom document; relative links resolved against `base`. */
export function parseFeed(text: string, base: string): Discovered[] {
	const doc: unknown = xml.parse(text);
	const out: Discovered[] = [];
	const rssItems = pick(doc, 'rss', 'channel', 'item') ?? pick(doc, 'rdf:RDF', 'item');
	const atom = pick(doc, 'feed');
	if (pick(doc, 'rss') || pick(doc, 'rdf:RDF')) {
		for (const item of asArray(rssItems)) {
			const guid = nodeText(pick(item, 'guid'));
			const link = nodeText(pick(item, 'link')) || (/^https?:/.test(guid) ? guid : '');
			const title = htmlText(nodeText(pick(item, 'title')));
			if (!link || !title) continue;
			out.push({
				url: normalizeUrl(link, base),
				title,
				publishedAt: parseDate(nodeText(pick(item, 'pubDate')) || nodeText(pick(item, 'dc:date'))),
				teaser: htmlText(nodeText(pick(item, 'description'))) || undefined
			});
		}
	} else if (atom) {
		for (const entry of asArray(pick(atom, 'entry'))) {
			const alternate = asArray(pick(entry, 'link')).find((l) => {
				const rel = pick(l, '@rel');
				return !rel || rel === 'alternate';
			});
			const link = nodeText(pick(alternate, '@href'));
			const title = htmlText(nodeText(pick(entry, 'title')));
			if (!link || !title) continue;
			out.push({
				url: normalizeUrl(link, base),
				title,
				publishedAt: parseDate(nodeText(pick(entry, 'published')) || nodeText(pick(entry, 'updated'))),
				teaser: htmlText(nodeText(pick(entry, 'summary'))) || undefined
			});
		}
	} else {
		throw new Error('not an RSS or Atom document');
	}
	return out;
}

/** Entries of a sitemap; Google News entries carry title and publication date. */
export function parseNewsSitemap(text: string, base: string): Discovered[] {
	const doc: unknown = xml.parse(text);
	const urlset = pick(doc, 'urlset');
	if (!urlset) throw new Error('not a sitemap urlset');
	const out: Discovered[] = [];
	for (const entry of asArray(pick(urlset, 'url'))) {
		const loc = nodeText(pick(entry, 'loc'));
		if (!loc) continue;
		out.push({
			url: normalizeUrl(loc, base),
			title: htmlText(nodeText(pick(entry, 'news:news', 'news:title'))),
			publishedAt: parseDate(nodeText(pick(entry, 'news:news', 'news:publication_date')) || nodeText(pick(entry, 'lastmod')))
		});
	}
	return out;
}

export interface FeedSource {
	url: string;
	kind: 'rss' | 'sitemap';
}

export interface DiscoverOptions {
	/** Keeps only URLs that look like articles of this outlet. */
	accept?: (url: URL) => boolean;
	/** Drops dated items older than this (feeds mix in evergreen items). Default 96 h. */
	maxAgeHours?: number;
}

/** Merges feeds and sitemaps: normalised, filtered, de-duplicated by URL, newest first. */
export function mergeDiscovered(lists: Discovered[][], opts: DiscoverOptions = {}): Discovered[] {
	const oldest = Date.now() - (opts.maxAgeHours ?? 96) * 3600_000;
	const byUrl = new Map<string, Discovered>();
	for (const item of lists.flat()) {
		if (opts.accept && !opts.accept(new URL(item.url))) continue;
		if (item.publishedAt && item.publishedAt.getTime() < oldest) continue;
		const known = byUrl.get(item.url);
		if (!known) {
			byUrl.set(item.url, { ...item });
			continue;
		}
		known.title ||= item.title;
		known.publishedAt ??= item.publishedAt;
		known.teaser ??= item.teaser;
	}
	return [...byUrl.values()]
		.filter((d) => d.title)
		.sort((a, b) => (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0));
}

/** Fetches every source; tolerates single failures but throws when all of them fail. */
export async function discoverFrom(sources: FeedSource[], opts: DiscoverOptions = {}): Promise<Discovered[]> {
	const results = await Promise.allSettled(
		sources.map(async (s) => {
			const { url, text } = await getText(s.url, { accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.5' });
			return s.kind === 'rss' ? parseFeed(text, url) : parseNewsSitemap(text, url);
		})
	);
	const lists: Discovered[][] = [];
	const errors: string[] = [];
	results.forEach((r, i) => {
		if (r.status === 'fulfilled') lists.push(r.value);
		else errors.push(`${sources[i].url}: ${(r.reason as Error).message}`);
	});
	if (!lists.length) throw new Error(`all discovery sources failed: ${errors.join('; ')}`);
	for (const e of errors) console.warn(`discovery source failed: ${e}`);
	return mergeDiscovered(lists, opts);
}

// ---------------------------------------------------------------- pages, JSON-LD, state blobs

/** Parsed HTML document (linkedom; no scripts run). */
export function parseDoc(html: string): Document {
	return parseHTML(html).document;
}

/**
 * Applies React streaming SSR the way its inline scripts would: completed Suspense boundaries
 * (`$RC("B:n","S:m")`) replace their fallback, and late segments (`$RS("S:n","P:n")`) replace
 * their placeholder template. Without this, server-rendered Next.js bodies stop half-way.
 */
export function resolveReactStream(doc: Document, html: string): void {
	for (const m of html.matchAll(/\$R([CS])\("([BSP]:[0-9a-z]+)","([BSP]:[0-9a-z]+)"\)/g)) {
		const [, kind, a, b] = m;
		const [segmentId, placeholderId] = kind === 'C' ? [b, a] : [a, b];
		const segment = doc.getElementById(segmentId);
		const placeholder = doc.getElementById(placeholderId);
		if (!segment || !placeholder?.parentNode) continue;
		const parent = placeholder.parentNode;
		let end: ChildNode | null = placeholder.nextSibling;
		if (kind === 'C') {
			// Remove the fallback up to the boundary's closing `<!--/$-->`.
			let depth = 0;
			while (end) {
				if (end.nodeType === 8) {
					const data = (end as Comment).data;
					if (data === '/$' && depth-- === 0) break;
					if (data.startsWith('$')) depth++;
				}
				const next: ChildNode | null = end.nextSibling;
				end.remove();
				end = next;
			}
		}
		for (const child of [...segment.childNodes]) parent.insertBefore(child, end);
		placeholder.remove();
		segment.remove();
	}
}

export async function fetchPage(url: string): Promise<{ url: string; html: string }> {
	const { url: finalUrl, text } = await getText(url, { accept: 'text/html,application/xhtml+xml' });
	return { url: finalUrl, html: text };
}

const ARTICLE_TYPES = /^(NewsArticle|Article|ReportageNewsArticle|AnalysisNewsArticle|OpinionNewsArticle|BackgroundNewsArticle|ReviewNewsArticle|BlogPosting|LiveBlogPosting)$/;

/** All JSON-LD objects of a page, with arrays and `@graph` flattened. Malformed blocks are ignored. */
export function jsonLd(doc: Document): object[] {
	const out: object[] = [];
	const visit = (v: unknown) => {
		if (Array.isArray(v)) v.forEach(visit);
		else if (v && typeof v === 'object') {
			out.push(v);
			if ('@graph' in v) visit(v['@graph']);
		}
	};
	for (const script of doc.querySelectorAll('script[type="application/ld+json"]')) {
		const text = script.textContent ?? '';
		try {
			visit(JSON.parse(text));
		} catch {
			try {
				// Raw control characters inside strings are a common JSON-LD defect.
				visit(JSON.parse(text.replace(/[\u0000-\u001f]+/g, ' ')));
			} catch {
				/* not parseable: ignore */
			}
		}
	}
	return out;
}

/** The page's article object from JSON-LD, if any; read it with `pick`. */
export function ldArticle(doc: Document): object | undefined {
	return jsonLd(doc).find((o) => asArray(pick(o, '@type')).some((t) => typeof t === 'string' && ARTICLE_TYPES.test(t)));
}

/** JSON-LD isAccessibleForFree: true / false (also the strings "True"/"False"), undefined if absent. */
export function ldFree(v: unknown): boolean | undefined {
	if (typeof v === 'boolean') return v;
	if (typeof v === 'string') {
		const s = v.trim().toLowerCase();
		if (s === 'true') return true;
		if (s === 'false') return false;
	}
	return undefined;
}

/** Author names of a JSON-LD article, joined. */
export function ldAuthor(v: unknown): string | undefined {
	const names = asArray(v)
		.map((a) => cleanText(typeof a === 'string' ? a : String(pick(a, 'name') ?? '')))
		.filter(Boolean);
	return names.length ? [...new Set(names)].join(', ') : undefined;
}

/** `<script id="__NEXT_DATA__">` of a Next.js pages-router site. */
export function nextData(html: string): unknown {
	const m = html.match(/<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
	if (!m) throw new ExtractError('no __NEXT_DATA__ on page');
	try {
		return JSON.parse(m[1]);
	} catch {
		throw new ExtractError('unparseable __NEXT_DATA__');
	}
}

/**
 * The object literal assigned after `marker` (e.g. `window.__INITIAL__STATE__=`), parsed without
 * evaluating it: the literal is cut at its balancing brace and the JS-only values `undefined`,
 * `NaN` and `Infinity` are turned into null before JSON.parse.
 */
export function assignedState(html: string, marker: string): unknown {
	const at = html.indexOf(marker);
	if (at < 0) throw new ExtractError(`no ${marker} on page`);
	const start = html.indexOf('{', at + marker.length);
	if (start < 0) throw new ExtractError(`no object after ${marker}`);
	const parts: string[] = [];
	let depth = 0;
	let from = start;
	let i = start;
	for (; i < html.length; i++) {
		const c = html[i];
		if (c === '"') {
			for (i++; i < html.length && html[i] !== '"'; i++) if (html[i] === '\\') i++;
		} else if (c === '{' || c === '[') depth++;
		else if (c === '}' || c === ']') {
			if (--depth === 0) break;
		} else if (c === 'u' || c === 'N' || c === 'I' || c === '-') {
			const word = /^-?(undefined|NaN|Infinity)\b/.exec(html.slice(i, i + 10));
			if (word && !/[\w$.]/.test(html[i - 1])) {
				parts.push(html.slice(from, i), 'null');
				i += word[0].length - 1;
				from = i + 1;
			}
		}
	}
	if (depth !== 0) throw new ExtractError(`unterminated ${marker} object`);
	parts.push(html.slice(from, i + 1));
	try {
		return JSON.parse(parts.join(''));
	} catch (e) {
		throw new ExtractError(`unparseable ${marker} object: ${(e as Error).message}`);
	}
}

/** Validates outlet state data; a shape change is an extractor failure, reported with its path. */
export function validate<T extends z.ZodType>(schema: T, data: unknown, what: string): z.infer<T> {
	const result = schema.safeParse(data);
	if (!result.success) {
		const issue = result.error.issues[0];
		throw new ExtractError(`unexpected ${what} shape at ${issue.path.join('.') || '(root)'}: ${issue.message}`);
	}
	return result.data;
}

// ---------------------------------------------------------------- body builder

export type ImageInput = Omit<ExtractedImage, 'position'>;

/** Collects blocks and images in document order: lead image at 0, body figures from 1. */
export class Body {
	readonly blocks: Block[] = [];
	readonly images: ExtractedImage[] = [];
	private readonly keys = new Set<string>();
	private next = 1;

	/** Sets the lead image (position 0); `key` identifies the photo so a body repeat is skipped. */
	lead(img: ImageInput | null | undefined, key?: string): void {
		if (!img?.url || this.images.some((i) => i.position === 0)) return;
		this.keys.add(key ?? img.url);
		this.images.unshift({ position: 0, ...tidyImage(img) });
	}

	figure(img: ImageInput | null | undefined, key?: string): void {
		if (!img?.url) return;
		const k = key ?? img.url;
		if (this.keys.has(k)) return;
		this.keys.add(k);
		const position = this.next++;
		this.images.push({ position, ...tidyImage(img) });
		this.blocks.push({ type: 'figure', image: position });
	}

	p(text: string | null | undefined): void {
		const t = cleanText(text);
		if (t && !PROMO_TEXT.test(t) && !NEWSLETTER.test(t)) this.blocks.push({ type: 'p', text: t });
	}

	h(text: string | null | undefined): void {
		const t = cleanText(text);
		if (t && !PROMO_TEXT.test(t)) this.blocks.push({ type: 'h', text: t });
	}

	quote(text: string | null | undefined, cite?: string): void {
		const t = cleanText(text);
		const c = cleanText(cite);
		if (t) this.blocks.push(c ? { type: 'quote', text: t, cite: c } : { type: 'quote', text: t });
	}

	list(items: (string | null | undefined)[], ordered = false): void {
		const clean = items.map(cleanText).filter(Boolean);
		if (clean.length) this.blocks.push({ type: 'list', ordered, items: clean });
	}

	get paragraphs(): number {
		return this.blocks.filter((b) => b.type === 'p').length;
	}

	get textLength(): number {
		return this.blocks.reduce((n, b) => n + (b.type === 'list' ? b.items.join(' ').length : b.type === 'figure' ? 0 : b.text.length), 0);
	}

	/** Drops trailing headings (a subhead with nothing after it is a leftover of removed content). */
	private trim(): void {
		while (this.blocks.length && this.blocks[this.blocks.length - 1].type === 'h') this.blocks.pop();
	}

	/** Finished article; throws when nothing readable was found. */
	article(fields: ArticleFields): Article {
		this.trim();
		if (this.paragraphs === 0) throw new ExtractError('no body paragraphs');
		return { ...header(fields), blocks: this.blocks, images: this.images, paywalled: false };
	}
}

function tidyImage(img: ImageInput): ImageInput {
	const out: ImageInput = { url: img.url };
	const caption = cleanText(img.caption);
	const credit = cleanCredit(img.credit);
	const alt = cleanText(img.alt);
	if (caption) out.caption = caption;
	if (credit) out.credit = credit;
	if (alt) out.alt = alt;
	return out;
}

/** A locked article: metadata only, never any body text or photos. */
export function paywalled(fields: ArticleFields): Article {
	return { ...header(fields), blocks: [], images: [], paywalled: true };
}

export type ArticleFields = Omit<Article, 'blocks' | 'images' | 'paywalled'>;

/** Cleaned title, standfirst and byline; a page without a title is not an article. */
function header(fields: ArticleFields): ArticleFields {
	const title = cleanText(fields.title);
	if (!title) throw new ExtractError('no title');
	const out: ArticleFields = { ...fields, title };
	out.lead = cleanText(fields.lead) || undefined;
	out.author = cleanText(fields.author) || undefined;
	return out;
}

const JUNK_IMAGE = /(^data:)|\.svg(\?|$)|\.gif(\?|$)|logo|icon|avatar|favicon|sprite|placeholder|spacer|pixel|byline|author|headshot|\/ads?\//i;

/** Logos, icons, author headshots, tracking pixels and ad images. */
export function isJunkImage(url: string): boolean {
	return JUNK_IMAGE.test(url);
}

// ---------------------------------------------------------------- server-rendered HTML

/** Paragraphs that point elsewhere ("Lue myös: …", "Read more", embed fallbacks), not article text. */
const PROMO_TEXT = /^(mainos|lue (myös|lisää|koko)|katso (myös|video|kuvat)|kuuntele (juttu|artikkeli)|seuraa meitä|jos (upotus|upote|video|sisältö|julkaisu) ei näy|video:|related:|read more|see also|listen:|watch:|sign up for)(?![\p{L}\p{N}])/iu;
const NEWSLETTER = /(tilaa|tilata|sign up|subscribe).{0,80}(uutiskirje|newsletter)/i;

/** All visible text sits inside links: a teaser or "more on this" box, not article text. */
function linkOnly(el: Element): boolean {
	const links = [...el.querySelectorAll('a')];
	if (!links.length) return false;
	const squash = (s: string | null | undefined) => (s ?? '').replace(/[\s\u00a0\u00ad]+/g, '');
	return squash(el.textContent) === links.map((a) => squash(a.textContent)).join('');
}

/** Always removed before walking a body. */
const DROP_TAGS: Record<string, true> = Object.fromEntries(
	['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'IFRAME', 'BUTTON', 'FORM', 'INPUT', 'SVG', 'NAV', 'FOOTER', 'HEADER', 'ASIDE', 'VIDEO', 'AUDIO', 'OBJECT', 'EMBED', 'CANVAS', 'H1'].map((t) => [t, true])
);
const SOCIAL_EMBED = /twitter|instagram|tiktok|facebook|bluesky|threads|youtube|embed/i;

export interface HtmlBodyOptions {
	/** Extra selectors removed before walking (ads, related links, newsletter boxes, bios). */
	drop?: string[];
	/** Image data for a figure (or bare img/picture), or null to skip it. */
	figure?: (el: Element) => ImageInput | null;
	/** Selector of outlet-specific figure containers (besides `<figure>`), passed to `figure`. */
	figures?: string;
}

/** Appends the readable content of `root` to `body` in document order. */
export function htmlBlocks(root: Element, body: Body, opts: HtmlBodyOptions = {}): void {
	if (opts.drop?.length) for (const el of root.querySelectorAll(opts.drop.join(','))) el.remove();
	walk(root, body, opts);
}

function walk(el: Element, body: Body, opts: HtmlBodyOptions): void {
	for (const child of el.children) {
		const tag = child.tagName.toUpperCase();
		if (DROP_TAGS[tag] || child.getAttribute('hidden') !== null || child.getAttribute('aria-hidden') === 'true') continue;
		if (opts.figures && opts.figure && child.matches(opts.figures)) {
			body.figure(opts.figure(child));
			continue;
		}
		switch (tag) {
			case 'P': {
				// Some sites wrap a photo and its caption in a <p>; the outlet's figure reader decides.
				const img = opts.figure && child.querySelector('img, picture') ? opts.figure(child) : null;
				if (img) {
					body.figure(img);
					break;
				}
				if (!linkOnly(child)) body.p(child.textContent);
				break;
			}
			case 'H2':
			case 'H3':
			case 'H4':
			case 'H5':
			case 'H6': {
				if (!linkOnly(child)) body.h(child.textContent);
				break;
			}
			case 'BLOCKQUOTE': {
				if (SOCIAL_EMBED.test(child.getAttribute('class') ?? '') || linkOnly(child)) break;
				const paras = [...child.querySelectorAll('p')].map((p) => cleanText(p.textContent)).filter(Boolean);
				const cite = cleanText(child.querySelector('cite, footer')?.textContent);
				const text = paras.length ? paras.join(' ') : cleanText(child.textContent);
				body.quote(cite && text.endsWith(cite) ? text.slice(0, -cite.length).trim() : text, cite);
				break;
			}
			case 'UL':
			case 'OL': {
				const items = [...child.children].filter((li) => li.tagName === 'LI');
				// A list of bare links is a "read more" box, not content.
				if (!items.every(linkOnly)) body.list(items.map((li) => li.textContent), tag === 'OL');
				break;
			}
			case 'FIGURE':
			case 'PICTURE':
			case 'IMG':
				if (opts.figure) body.figure(opts.figure(child));
				break;
			default:
				walk(child, body, opts);
		}
	}
}

