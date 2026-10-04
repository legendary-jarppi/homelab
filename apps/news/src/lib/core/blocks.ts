// Stored article body: plain-text blocks rendered by our own components (no outlet HTML).
// Images are referenced by position: 0 = lead image, body figures 1..n (see images table).

export type Block =
	| { type: 'p'; text: string }
	| { type: 'h'; text: string }
	| { type: 'quote'; text: string; cite?: string }
	| { type: 'list'; ordered: boolean; items: string[] }
	| { type: 'figure'; image: number };

export interface ExtractedImage {
	/** 0 = lead image; body figures numbered in document order. */
	position: number;
	url: string;
	caption?: string;
	credit?: string;
	alt?: string;
}

export interface ExtractedArticle {
	title: string;
	/** Standfirst / ingress, if separate from the body. */
	lead?: string;
	author?: string;
	publishedAt?: Date;
	language?: string;
	blocks: Block[];
	images: ExtractedImage[];
	/** Machine-readable or heuristic paywall verdict for this page. */
	paywalled: boolean;
}

/** Visible text of the body (paragraphs, headings, quotes, list items), for length and search. */
export function blocksText(blocks: Block[]): string {
	return blocks
		.map((b) => (b.type === 'list' ? b.items.join('\n') : b.type === 'figure' ? '' : b.text))
		.filter(Boolean)
		.join('\n\n');
}
