// Contract between outlet modules (one per outlet in this directory) and the worker.
import type { ExtractedArticle } from '../blocks.ts';

/** An article found by discovery; the URL is normalised (tracking parameters removed). */
export interface Discovered {
	url: string;
	title: string;
	publishedAt?: Date;
	teaser?: string;
}

export interface OutletDef {
	slug: string;
	name: string;
	/** ISO 639-1 language of most articles. */
	language: string;
	homepage: string;
	/** Default classification priority (higher first); admins can change it in the database. */
	priority: number;
	/** Whether the outlet is enabled when first seeded. */
	enabledByDefault: boolean;
	/** Minutes between discovery runs. */
	discoveryIntervalMin: number;
	/** Finds recent articles (RSS, news sitemaps, listing APIs). Throws on outlet-wide failure. */
	discover(): Promise<Discovered[]>;
	/**
	 * Fetches and extracts one article. Paywalled articles return `paywalled: true` with empty
	 * blocks and images, and MUST NOT read body text the outlet only ships for subscribers.
	 * Throws ExtractError for pages that are not articles or cannot be parsed.
	 */
	extract(url: string): Promise<ExtractedArticle & { meta?: Record<string, unknown> }>;
}

/** A permanent, per-article extraction failure (not an article, unsupported format). */
export class ExtractError extends Error {
	/** 'skipped' = deliberately not ingested (video, live blog, gallery-only); 'failed' = broken. */
	readonly state: 'skipped' | 'failed';
	constructor(message: string, state: 'skipped' | 'failed' = 'failed') {
		super(message);
		this.state = state;
	}
}
