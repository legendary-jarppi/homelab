// Share links: https://news.shillyshally.org/share/<token>, the one path Cloudflare Access lets
// through without a login (Access application "News share links", bypass). Chat apps fetch it for
// their link preview and get the calm headline, summary and an untagged photo; a person opening it is
// sent on to /article/<id>, behind Access and the site's login as always.
//
// Tokens are "<article id in base 36>.<HMAC>" keyed by SHARE_SECRET (secret news-share): nothing is
// stored, links cannot be made up for other articles, and a new secret retires every link. Without
// the secret, Share passes the plain article address.
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Sql } from '$lib/core/db';
import { published } from '$lib/core/visibility';

const SECRET = process.env.SHARE_SECRET ?? '';

/** Link-preview fetchers (they get the preview page; everyone else goes on to the article). Apple's
 *  Messages calls itself facebookexternalhit/Twitterbot; Signal calls itself WhatsApp. */
export const PREVIEW_AGENTS =
	/facebookexternalhit|Facebot|Twitterbot|WhatsApp|TelegramBot|Slackbot|Slack-ImgProxy|Discordbot|LinkedInBot|SkypeUriPreview|Viber|Mastodon|Bluesky|redditbot|Iframely|Embedly/i;

const mac = (id: number) => createHmac('sha256', SECRET).update(`share:${id}`).digest('base64url').slice(0, 22);

/** The article's share token; null when no SHARE_SECRET is set. */
export function shareToken(id: number): string | null {
	return SECRET ? `${id.toString(36)}.${mac(id)}` : null;
}

/** The article id a token stands for, or null for anything not made by shareToken(). */
export function parseShareToken(token: string): number | null {
	const m = /^([0-9a-z]{1,12})\.([A-Za-z0-9_-]{22})$/.exec(token);
	if (!SECRET || !m) return null;
	const id = parseInt(m[1], 36);
	if (!Number.isSafeInteger(id)) return null;
	const expected = Buffer.from(mac(id));
	return timingSafeEqual(expected, Buffer.from(m[2])) ? id : null;
}

export interface SharePreview {
	headline: string;
	summary: string | null;
	outlet: string;
	language: string | null;
	/** The first photo that was assessed and got no sensitivity tag at all (the preview skips every
	 *  reader's settings, so only photos nobody could be filtering out); null for none. */
	photoPath: string | null;
}

/** What a share link may show of an article still in the paper; null if it is not. */
export async function sharePreview(sql: Sql, id: number): Promise<SharePreview | null> {
	const [row] = await sql<{ title: string; calm_title: string | null; summary: string | null; outlet: string; language: string | null; photo_path: string | null }[]>`
		SELECT a.title, a.calm_title, a.summary, o.name AS outlet, a.language,
			(SELECT i.path FROM images i
				WHERE i.article_id = a.id AND i.state = 'stored' AND i.path IS NOT NULL AND i.assessed
					AND NOT EXISTS (SELECT 1 FROM image_tags it WHERE it.image_id = i.id)
				ORDER BY i.position LIMIT 1) AS photo_path
		FROM articles a JOIN outlets o ON o.id = a.outlet_id
		WHERE a.id = ${id} AND ${published(sql)}`;
	if (!row) return null;
	return { headline: row.calm_title ?? row.title, summary: row.summary, outlet: row.outlet, language: row.language, photoPath: row.photo_path };
}
