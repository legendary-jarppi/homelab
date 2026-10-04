// Article classification: prompt, JSON schema, call, and validation/normalisation.
import { z } from 'zod';
import { blocksText, type Block } from './blocks.ts';
import { structured, type ContentBlock, type LlmConfig, type StructuredResponse } from './llm.ts';
import { INTENSITIES, SENSITIVITY_FAMILIES, SENSITIVITY_TAGS, TAG_KEYS, TOPICS, TOPIC_KEYS, type Intensity } from './taxonomy.ts';

/** Bump when the prompt, schema or input format changes; stored with every result. */
export const PROMPT_VERSION = 'v1';

export const ARTICLE_KINDS = ['news', 'opinion', 'analysis', 'feature', 'interview', 'live-blog', 'gallery', 'sponsored', 'other'] as const;

/** Body text beyond this is abridged (lead + evenly spaced samples + ending); see buildArticleText. */
const MAX_BODY_CHARS = 40_000;

const familyLabel = Object.fromEntries(SENSITIVITY_FAMILIES.map((f) => [f.key, f.label]));

const SYSTEM_PROMPT = `You classify news articles for a news service used by people who are sensitive to distressing content. Each reader chooses which kinds of content to avoid and how strongly; your labels decide what they see. Missing a label exposes a reader to something they asked not to see; an extra label only hides one article. When genuinely unsure, include the label.

You receive one article: metadata, the full text, image captions, and the article's photos (numbered to match the captions). Assess the text AND the photos.

## Topics
Choose 1 to 3 topics, most central first. Use "other" only when nothing else fits.
${TOPICS.map((t) => `- ${t.key}: ${t.description}`).join('\n')}

## Sensitivity tags
Label every kind of potentially distressing content the article contains, from the text or the photos. Labels are descriptive, not moral: they state what the article contains.
${SENSITIVITY_FAMILIES.map(
	(f) => `### ${f.label}\n${SENSITIVITY_TAGS.filter((t) => t.family === f.key).map((t) => `- ${t.key}: ${t.description}`).join('\n')}`
).join('\n')}

Notes:
- death-general: any death or fatality, including deaths of public figures, accidents and war casualties. Also tag the more specific death tags when they apply.
- armed-conflict applies to any article about an ongoing war or military strikes, even when the angle is diplomatic or economic, as long as fighting, casualties or destruction are referred to.
- Phobia tags (insects, snakes, rodents, heights, confined spaces, deep water, clustered holes, macabre imagery) apply even to neutral or positive articles: a cheerful piece about spiders still gets insects-arachnids.
- graphic-imagery: only for photos that are themselves distressing (injuries, bodies, destruction with victims, blood, suffering).
- sensationalism: alarmist, outrage-driven or clickbait framing of the headline or text.

## Intensity
Each tag gets one intensity, judged against the whole article:
- mention: referred to in passing (a clause or a sentence or two); no detail; not what the article is about.
- description: a substantive part of the article, described in concrete terms but without graphic detail.
- graphic: vivid, explicit or gory treatment in the text, or a photo that shows it explicitly.
If you are torn between two intensities, choose the higher one. Set basis to "images" when only the photos carry the tag, "both" when text and photos do.

## Photos
For each photo that shows something covered by a sensitivity tag, list it under images with its number and tags. Intensity for photos: mention = only indirectly present (e.g. memorial candles, a police car); description = clearly shown but not explicit; graphic = explicit, gory or shocking. Omit photos that need no tags.

## Calm headline
Rewrite the headline in the article's language as a calm, factual headline: no clickbait, no sensational or emotive words, no question-baiting, no ALL CAPS, no exclamation marks; keep it accurate and roughly as long as the original. Avoid naming distressing specifics (methods of harm, injuries, graphic acts) unless the headline is meaningless without them. If the original is already calm and factual, return it unchanged.

## Summary
One or two sentences in the article's language saying what the article is about, factual and neutral, without distressing specifics or graphic detail.

## Importance
How prominently a serious newspaper would place this article today:
5 = major national or world news of the day; 4 = significant news; 3 = ordinary news; 2 = minor news, routine results, light features; 1 = trivial items, filler, lists, horoscopes, product promotion.

## Kind
news, opinion (columns, editorials, letters), analysis, feature, interview, live-blog (running updates), gallery (mostly photos), sponsored (advertorials, "kaupallinen yhteistyö", partner content), or other.

## Language
ISO 639-1 code of the article text (e.g. fi, en, sv).`;

const tagSchema = {
	type: 'object',
	properties: {
		tag: { type: 'string', enum: TAG_KEYS },
		intensity: { type: 'string', enum: INTENSITIES },
		basis: { type: 'string', enum: ['text', 'images', 'both'] },
		confidence: { type: 'number' }
	},
	required: ['tag', 'intensity', 'basis', 'confidence'],
	additionalProperties: false
};

const OUTPUT_SCHEMA = {
	type: 'object',
	properties: {
		language: { type: 'string' },
		kind: { type: 'string', enum: ARTICLE_KINDS },
		topics: {
			type: 'array',
			items: {
				type: 'object',
				properties: { topic: { type: 'string', enum: TOPIC_KEYS }, confidence: { type: 'number' } },
				required: ['topic', 'confidence'],
				additionalProperties: false
			}
		},
		tags: { type: 'array', items: tagSchema },
		images: {
			type: 'array',
			items: {
				type: 'object',
				properties: {
					number: { type: 'integer' },
					tags: {
						type: 'array',
						items: {
							type: 'object',
							properties: { tag: { type: 'string', enum: TAG_KEYS }, intensity: { type: 'string', enum: INTENSITIES } },
							required: ['tag', 'intensity'],
							additionalProperties: false
						}
					}
				},
				required: ['number', 'tags'],
				additionalProperties: false
			}
		},
		calm_title: { type: 'string' },
		summary: { type: 'string' },
		importance: { type: 'integer' }
	},
	required: ['language', 'kind', 'topics', 'tags', 'images', 'calm_title', 'summary', 'importance'],
	additionalProperties: false
};

const Output = z.object({
	language: z.string(),
	kind: z.enum(ARTICLE_KINDS),
	topics: z.array(z.object({ topic: z.enum(TOPIC_KEYS as [string, ...string[]]), confidence: z.number() })),
	tags: z.array(
		z.object({
			tag: z.enum(TAG_KEYS as [string, ...string[]]),
			intensity: z.enum(INTENSITIES),
			basis: z.enum(['text', 'images', 'both']),
			confidence: z.number()
		})
	),
	images: z.array(
		z.object({
			number: z.number().int(),
			tags: z.array(z.object({ tag: z.enum(TAG_KEYS as [string, ...string[]]), intensity: z.enum(INTENSITIES) }))
		})
	),
	calm_title: z.string().min(1),
	summary: z.string().min(1),
	importance: z.number().int()
});

export interface ClassifyInput {
	outlet: string;
	title: string;
	lead?: string | null;
	publishedAt: Date;
	blocks: Block[];
	/** Photo position (0 = lead image) and its caption; data = downscaled JPEG, or null if unavailable. */
	images: { position: number; caption?: string | null; credit?: string | null; alt?: string | null; jpeg: Buffer | null }[];
}

export interface ClassifyResult {
	language: string;
	kind: (typeof ARTICLE_KINDS)[number];
	topics: { topic: string; confidence: number }[];
	tags: { tag: string; intensity: Intensity; confidence: number; basis: 'text' | 'images' | 'both' }[];
	/** By image position; only positions that were sent to the model appear in `assessed`. */
	imageTags: Map<number, { tag: string; intensity: Intensity }[]>;
	assessed: number[];
	calmTitle: string;
	summary: string;
	importance: number;
	call: StructuredResponse;
}

/** Article text for the model; long bodies keep the lead, the ending and evenly spaced samples. */
export function buildArticleText(input: ClassifyInput, sentImages: number[]): string {
	const parts: string[] = [];
	const imageNumber = (position: number) => sentImages.indexOf(position) + 1;
	for (const block of input.blocks) {
		if (block.type === 'p') parts.push(block.text);
		else if (block.type === 'h') parts.push(`## ${block.text}`);
		else if (block.type === 'quote') parts.push(`> ${block.text}${block.cite ? ` — ${block.cite}` : ''}`);
		else if (block.type === 'list') parts.push(block.items.map((i) => `- ${i}`).join('\n'));
		else if (block.type === 'figure') {
			const image = input.images.find((i) => i.position === block.image);
			const n = imageNumber(block.image);
			const caption = [image?.caption, image?.alt].filter(Boolean).join(' / ');
			parts.push(`[${n > 0 ? `Photo ${n}` : 'Photo (not shown)'}${caption ? `: ${caption}` : ''}]`);
		}
	}
	let body = parts.join('\n\n');
	const fullLength = body.length;
	if (body.length > MAX_BODY_CHARS) {
		// Structural abridgement: head, tail and evenly spaced samples, never chosen by content.
		const slice = Math.floor(MAX_BODY_CHARS / 6);
		const samples = [0, 1, 2, 3].map((i) => {
			const start = Math.floor(slice + ((fullLength - 3 * slice) * i) / 3);
			return body.slice(start, start + slice);
		});
		body = [body.slice(0, slice * 1.5), ...samples, body.slice(fullLength - slice * 0.5)].join('\n\n[…]\n\n');
		body = `[Abridged: the full body is ${fullLength} characters; ${body.length} shown. Judge mention vs description against the full length.]\n\n${body}`;
	}
	const lead = input.images.find((i) => i.position === 0);
	const leadCaption = lead ? [lead.caption, lead.alt].filter(Boolean).join(' / ') : '';
	return [
		`Outlet: ${input.outlet}`,
		`Published: ${input.publishedAt.toISOString()}`,
		`Headline: ${input.title}`,
		input.lead ? `Standfirst: ${input.lead}` : null,
		lead ? `Lead photo${imageNumber(0) > 0 ? ` (Photo ${imageNumber(0)})` : ''}${leadCaption ? `: ${leadCaption}` : ''}` : null,
		'',
		body
	]
		.filter((l) => l !== null)
		.join('\n');
}

const MAX_IMAGES = Number(process.env.CLASSIFY_MAX_IMAGES ?? 8);

export async function classify(config: LlmConfig, input: ClassifyInput, model?: string): Promise<ClassifyResult> {
	const sent = input.images.filter((i) => i.jpeg).slice(0, MAX_IMAGES);
	const sentPositions = sent.map((i) => i.position);
	const content: ContentBlock[] = [];
	sent.forEach((image, index) => {
		content.push({ type: 'text', text: `Photo ${index + 1}:` });
		content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: image.jpeg!.toString('base64') } });
	});
	content.push({ type: 'text', text: buildArticleText(input, sentPositions) });

	const call = await structured(config, { system: SYSTEM_PROMPT, content, schema: OUTPUT_SCHEMA, maxTokens: 4000, model });
	const out = Output.parse(call.json);

	const topics = [...new Map(out.topics.map((t) => [t.topic, t])).values()].slice(0, 3);
	// Duplicate tags: keep the highest intensity.
	const tags = new Map<string, ClassifyResult['tags'][number]>();
	for (const t of out.tags) {
		const prev = tags.get(t.tag);
		if (!prev || INTENSITIES.indexOf(t.intensity) > INTENSITIES.indexOf(prev.intensity)) tags.set(t.tag, t);
	}
	const imageTags = new Map<number, { tag: string; intensity: Intensity }[]>();
	for (const image of out.images) {
		const position = sentPositions[image.number - 1];
		if (position !== undefined && image.tags.length > 0) imageTags.set(position, image.tags);
	}
	// A tag found on a photo is also an article-level tag (a reader avoiding it should not get the article).
	for (const list of imageTags.values()) {
		for (const t of list) {
			const prev = tags.get(t.tag);
			if (!prev) tags.set(t.tag, { ...t, confidence: 1, basis: 'images' });
			else if (INTENSITIES.indexOf(t.intensity) > INTENSITIES.indexOf(prev.intensity)) tags.set(t.tag, { ...prev, intensity: t.intensity, basis: 'both' });
		}
	}
	return {
		language: out.language.toLowerCase().slice(0, 2),
		kind: out.kind,
		topics: topics.length > 0 ? topics : [{ topic: 'other', confidence: 0 }],
		tags: [...tags.values()],
		imageTags,
		assessed: sentPositions,
		calmTitle: out.calm_title.trim(),
		summary: out.summary.trim(),
		importance: Math.min(5, Math.max(1, out.importance)),
		call
	};
}

export { blocksText };
