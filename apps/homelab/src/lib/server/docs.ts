import { posix } from 'node:path';
import { Marked, Renderer, TextRenderer, type Tokens } from 'marked';
import { COMPONENTS } from '$lib/architecture';

// The repository's markdown, bundled at build time: every README, docs/*.md and the other markdown
// next to them (apps/news's design notes). `$repo` is the repository root (svelte.config.js); in the
// image build deploy.sh stages the same layout, in `npm run dev` these are the live files.
const SOURCES = import.meta.glob<string>(
	['$repo/README.md', '$repo/docs/*.md', '$repo/platform/**/*.md', '$repo/apps/*.md', '$repo/apps/*/*.md', '$repo/apps/*/docs/*.md', '!**/node_modules/**'],
	{ query: '?raw', import: 'default', eager: true }
);

export interface Doc {
	/** Repo path, e.g. "apps/climate/README.md". */
	path: string;
	title: string;
	markdown: string;
}

/** By repo path; root README first, then docs/, platform/, apps/, each with its README first. */
export const DOCS = new Map(
	Object.entries(SOURCES)
		.map(([key, markdown]): Doc => {
			// Glob keys are relative to this app (apps/homelab): "../../README.md", "../climate/README.md".
			const path = posix.normalize(posix.join('apps/homelab', key.replace(/^\//, '')));
			const title = /^#\s+(.+)$/m.exec(markdown)?.[1].replace(/[*_`]/g, '').trim();
			return { path, markdown, title: title ?? path };
		})
		.sort((a, b) => sortKey(a.path).localeCompare(sortKey(b.path)))
		.map((d) => [d.path, d] as const)
);

function sortKey(path: string): string {
	const top = ['README.md', 'docs/', 'platform/', 'apps/'].findIndex((p) => path === p || path.startsWith(p));
	// README.md sorts before its siblings and subdirectories.
	return `${top}/${path.replace(/README\.md$/, '\0')}`;
}

/** Docs with their own page get that address; the rest live under /docs. */
const PAGES: Record<string, string> = {
	'docs/future-plans.md': '/plans',
	'docs/shopping-list.md': '/shopping'
};

/** Where a repo markdown file is shown. */
export const docHref = (path: string) => PAGES[path] ?? `/docs/${path}`;

/** The docs page for a model `docs` reference ("path#anchor"), or null when that file is not bundled. */
export function docsLink(ref: string | undefined): string | null {
	if (!ref) return null;
	const [path, hash] = ref.split('#');
	return DOCS.has(path) ? `${docHref(path)}${hash ? `#${hash}` : ''}` : null;
}

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** GitHub's heading anchors: lower case, punctuation dropped, each space a dash. */
const slugify = (text: string) =>
	text
		.toLowerCase()
		.trim()
		.replace(/[^\p{L}\p{N}\s_-]/gu, '')
		.replace(/\s/g, '-');

/** The repo path a relative link in `from` points at, without its #fragment. */
function resolve(from: string, target: string): string {
	const joined = target.startsWith('/') ? target.slice(1) : posix.join(posix.dirname(from), target);
	return posix.normalize(joined).replace(/\/$/, '');
}

/** Render state of the document being converted (marked renders synchronously). */
let current = { path: '', excerpt: false, slugs: new Map<string, number>() };

const marked = new Marked({
	gfm: true,
	renderer: {
		heading({ tokens, depth }: Tokens.Heading) {
			const text = this.parser.parseInline(tokens, new TextRenderer());
			let id = slugify(text);
			const seen = current.slugs.get(id) ?? 0;
			current.slugs.set(id, seen + 1);
			if (seen > 0) id = `${id}-${seen}`;
			return `<h${depth} id="${escapeHtml(id)}"><a class="anchor" href="#${escapeHtml(id)}" aria-hidden="true">#</a>${this.parser.parseInline(tokens)}</h${depth}>\n`;
		},
		link({ href, title, tokens }: Tokens.Link) {
			const inner = this.parser.parseInline(tokens);
			const titleAttr = title ? ` title="${escapeHtml(title)}"` : '';
			if (/^[a-z][a-z0-9+.-]*:|^\/\//i.test(href)) return `<a href="${escapeHtml(href)}"${titleAttr} target="_blank" rel="noopener">${inner}</a>`;
			if (href.startsWith('#')) {
				const page = current.excerpt ? docHref(current.path) : '';
				return `<a href="${escapeHtml(page + href)}"${titleAttr}>${inner}</a>`;
			}
			const [target, hash] = href.split('#');
			const path = resolve(current.path, decodeURIComponent(target));
			const doc = DOCS.has(path) ? path : DOCS.has(`${path}/README.md`) ? `${path}/README.md` : null;
			// Links to code, manifests or directories without a README: nothing to open here.
			if (!doc) return `<span class="file"${titleAttr}>${inner}</span>`;
			return `<a href="${escapeHtml(docHref(doc) + (hash ? `#${hash}` : ''))}"${titleAttr}>${inner}</a>`;
		},
		code({ text, lang, escaped }: Tokens.Code) {
			const body = escaped ? text : escapeHtml(text);
			// Drawn in the browser by mermaid (Markdown.svelte), which reads the text back.
			if (lang === 'mermaid') return `<pre class="mermaid">${body}</pre>\n`;
			return `<pre class="code"><code${lang ? ` data-lang="${escapeHtml(lang)}"` : ''}>${body}</code></pre>\n`;
		},
		table(token: Tokens.Table) {
			return `<div class="table">${Renderer.prototype.table.call(this, token)}</div>\n`;
		}
	}
});

/** HTML of `markdown` (default: the whole file at `path`), with links resolved from `path`. */
export function render(path: string, markdown = DOCS.get(path)?.markdown ?? ''): string {
	current = { path, excerpt: markdown !== DOCS.get(path)?.markdown, slugs: new Map() };
	return marked.parse(markdown, { async: false });
}

/**
 * One section of a doc: from the heading with this text to the next heading of the same or a higher
 * level; `null` = the lead, between the title and the first subheading. Empty when not found.
 */
export function section(path: string, heading: string | null): string {
	const lines = (DOCS.get(path)?.markdown ?? '').split('\n');
	let fenced = false;
	const headings = lines.flatMap((line, i) => {
		if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
		const m = !fenced && /^(#{1,6})\s+(.*?)\s*$/.exec(line);
		return m ? [{ i, level: m[1].length, text: m[2] }] : [];
	});
	if (heading === null) {
		const title = headings.find((h) => h.level === 1);
		const next = headings.find((h) => h.i > (title?.i ?? -1));
		return lines.slice((title?.i ?? -1) + 1, next?.i ?? lines.length).join('\n');
	}
	const start = headings.find((h) => h.text === heading);
	if (!start) return '';
	const end = headings.find((h) => h.i > start.i && h.level <= start.level);
	return lines.slice(start.i, end?.i ?? lines.length).join('\n');
}

/** Per component (node id): its docs page and, for a planned device, the plan; the diagrams' `links`. */
export function componentLinks(): Record<string, { docs?: string; plan?: string }> {
	return Object.fromEntries(
		COMPONENTS.groups.flatMap((g) =>
			g.nodes.map((n) => [n.id, { docs: docsLink(n.docs ?? g.app?.docs) ?? undefined, plan: docsLink(n.device?.planned) ?? undefined }])
		)
	);
}

/** Per app group (group id): its docs page. */
export function appLinks(): Record<string, string> {
	return Object.fromEntries(COMPONENTS.groups.flatMap((g): [string, string][] => {
		const href = g.app && docsLink(g.app.docs);
		return href ? [[g.id, href]] : [];
	}));
}
