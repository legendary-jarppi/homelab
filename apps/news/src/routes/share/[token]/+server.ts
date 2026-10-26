import { error, redirect } from '@sveltejs/kit';
import { db } from '$lib/core/db';
import { parseShareToken, PREVIEW_AGENTS, sharePreview } from '$lib/server/share';
import type { RequestHandler } from './$types';

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/**
 * A share link, public (no session; Access bypass on /share/). Link-preview fetchers get a page of
 * Open Graph tags (calm headline, summary, untagged photo); anyone else is sent to the article, where
 * Access and the site's login apply as always.
 */
export const GET: RequestHandler = async ({ params, request, url }) => {
	const id = parseShareToken(params.token);
	if (id === null) error(404, 'Not found');
	if (!PREVIEW_AGENTS.test(request.headers.get('user-agent') ?? '')) redirect(303, `/article/${id}`);

	const preview = await sharePreview(db(), id);
	if (!preview) error(404, 'Not found');
	const base = (process.env.PUBLIC_BASE_URL ?? url.origin).replace(/\/+$/, '');
	const self = `${base}/share/${params.token}`;
	const meta: [string, string][] = [
		['og:type', 'article'],
		['og:site_name', 'Shilly Shally News'],
		['og:title', preview.headline],
		['og:description', preview.summary ?? `From ${preview.outlet}`],
		['og:url', self]
	];
	if (preview.photoPath) meta.push(['og:image', `${self}/image.jpg`], ['og:image:type', 'image/jpeg']);
	const html = `<!doctype html>
<html lang="${escape(preview.language ?? 'en')}">
<head>
<meta charset="utf-8">
<title>${escape(preview.headline)} · Shilly Shally News</title>
<meta name="robots" content="noindex, nofollow">
<meta name="description" content="${escape(preview.summary ?? '')}">
${meta.map(([p, c]) => `<meta property="${p}" content="${escape(c)}">`).join('\n')}
<meta name="twitter:card" content="${preview.photoPath ? 'summary_large_image' : 'summary'}">
</head>
<body><p><a href="/article/${id}">${escape(preview.headline)}</a> · Shilly Shally News</p></body>
</html>
`;
	return new Response(html, {
		// private: Cloudflare's edge does not keep it, so a purged article's preview goes with it.
		headers: { 'content-type': 'text/html; charset=utf-8', 'x-robots-tag': 'noindex, nofollow', 'cache-control': 'private, max-age=3600' }
	});
};
