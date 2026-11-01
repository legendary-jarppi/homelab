// Entity extraction: one text-only model call per classified article naming the people,
// organisations, places and other named things central to it. Entities are shared across articles
// and outlets by (kind, norm), so the prompt asks for one canonical (Finnish, nominative) name per
// entity. A failure only leaves an article without its "people and things" list.
import { z } from 'zod';
import { blocksText, type Block } from '../blocks.ts';
import type { Sql } from '../db.ts';
import { LlmError, structured, type LlmConfig, type StructuredResponse } from '../llm.ts';
import { errorText, log } from './log.ts';

/**
 * Compared 2026-11-01 on 15 Finnish articles (5 stories x 3 outlets) and 3 NPR articles. Both
 * models used Finnish names for English articles ("Ranska", "Pohjois-Korea") and mostly chose the
 * same entities. claude-sonnet-5-5 gave every name in its base form; claude-haiku-4-5 was about 40 %
 * cheaper per call (no prompt caching below its minimum prompt length, older tokenizer) but returned
 * an inflected place ("Raahes" from "Raahesta") and an English event name. A wrong name splits an
 * entity, so Sonnet is the default.
 */
export const ENTITY_MODEL = process.env.ENTITY_MODEL ?? 'claude-sonnet-5-5';
/** Articles published within this many days are queued (also the backfill on first deploy). */
const BACKFILL_DAYS = Number(process.env.ENTITY_BACKFILL_DAYS ?? 30);
/** Failed calls per article before it is left without entities (keeps the queue from looping). */
export const ENTITY_MAX_ATTEMPTS = 3;
const MAX_ENTITIES = 6;
/** Body text sent to the model; entities central to a story appear early. */
const MAX_BODY_CHARS = 8000;

export const ENTITY_KINDS = ['person', 'organisation', 'place', 'other'] as const;
export type EntityKind = (typeof ENTITY_KINDS)[number];

const SYSTEM_PROMPT = `You list the named entities a news article is about, for a news service that links each entity to every other article about it, across outlets and languages. The same entity must therefore always get exactly the same name.

Return at most ${MAX_ENTITIES} entities, most central first. Fewer is fine; return none when nothing qualifies.

## Which entities
- Only entities the article is substantially about or that play a real role in the story. Leave out passing mentions, background references, people only quoted in passing as experts, and examples.
- Never the outlet that published the article, its journalists, or its other products. Other media only when the story is about them, not when they are merely cited as a source ("CNN reported").
- A generic place (such as the country of a domestic story, or the city where an event merely happened) only when the place itself is the subject.
- Never a generic noun as a name ("poliisi", "hallitus", "sairaala"): name the specific organisation when the article does ("Itä-Suomen poliisilaitos"), otherwise leave it out.

## Kinds
- person: a real individual.
- organisation: companies, authorities, ministries, parties, unions, international organisations, courts, universities, associations.
- place: countries, regions, cities, municipalities, neighbourhoods, natural places. Countries are places also when they act politically ("Venäjä vaati").
- other: events, products, works (books, films, series, songs), laws and treaties, sports teams, bands and competitions, brands, named weather events and the like.

## Names
- Always the base (nominative) form, never an inflected one: "Helsinki", not "Helsingissä"; "Petteri Orpo", not "Orpon"; "Nato", not "Natoon".
- People by their full name as commonly written in Finnish news ("Petteri Orpo", "Donald Trump", "Volodymyr Zelenskyi"), even when the article uses only a surname or a title.
- Organisations, places, events, laws and treaties by their established Finnish name when one exists, also in English-language articles: "Yhdysvallat" (not "United States"), "Venäjä", "Kiina", "Nato", "YK", "EU", "Euroopan komissio", "Valkoinen talo", "Yhdysvaltain kongressi", "Ukrainan sota", "Yhdysvaltain välivaalit". Abbreviations that Finnish news use as the name stay abbreviations ("YK", "EU", "Nato", "HUS", "Kela", "WHO").
- Finnish authorities by their own name without a country prefix ("Ulkoministeriö", "Poliisihallitus"); foreign ones with the country ("Yhdysvaltain ulkoministeriö"). Names are shown as standalone labels, so start them with a capital letter.
- Otherwise the name as it is commonly written in its own language ("Federal Reserve", "Microsoft", "Taylor Swift").
- No descriptions, titles or articles in the name: "Alexander Stubb", not "presidentti Alexander Stubb".`;

const OUTPUT_SCHEMA = {
	type: 'object',
	properties: {
		entities: {
			type: 'array',
			items: {
				type: 'object',
				properties: { name: { type: 'string' }, kind: { type: 'string', enum: ENTITY_KINDS } },
				required: ['name', 'kind'],
				additionalProperties: false
			}
		}
	},
	required: ['entities'],
	additionalProperties: false
};

const Output = z.object({ entities: z.array(z.object({ name: z.string(), kind: z.enum(ENTITY_KINDS) })) });

export interface EntityInput {
	outlet: string;
	title: string;
	lead: string | null;
	blocks: Block[];
}

export interface Entity {
	kind: EntityKind;
	name: string;
	norm: string;
}

/** Lower-case, unaccented, whitespace-collapsed: the identity of an entity within its kind. */
export function entityNorm(name: string): string {
	return name.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** The model's text: outlet, headline, standfirst and the body cut at a word boundary. */
export function entityText(input: EntityInput): string {
	let body = blocksText(input.blocks);
	if (body.length > MAX_BODY_CHARS) {
		const cut = body.lastIndexOf(' ', MAX_BODY_CHARS);
		body = `${body.slice(0, cut > 0 ? cut : MAX_BODY_CHARS)} […]`;
	}
	return [`Outlet: ${input.outlet}`, `Headline: ${input.title}`, input.lead ? `Standfirst: ${input.lead}` : null, '', body]
		.filter((l) => l !== null)
		.join('\n');
}

export interface EntityExtraction {
	/** Deduplicated by (kind, norm), most central first. */
	entities: Entity[];
	call: StructuredResponse;
}

/** One extraction call. */
export async function extractEntities(config: LlmConfig, input: EntityInput, model = ENTITY_MODEL): Promise<EntityExtraction> {
	const call = await structured(config, {
		system: SYSTEM_PROMPT,
		content: [{ type: 'text', text: entityText(input) }],
		schema: OUTPUT_SCHEMA,
		maxTokens: 600,
		model
	});
	const seen = new Set<string>();
	const entities: Entity[] = [];
	for (const e of Output.parse(call.json).entities) {
		const name = e.name.replace(/\s+/g, ' ').trim();
		const norm = entityNorm(name);
		if (!norm || seen.has(`${e.kind}:${norm}`)) continue;
		seen.add(`${e.kind}:${norm}`);
		entities.push({ kind: e.kind, name, norm });
	}
	return { entities: entities.slice(0, MAX_ENTITIES), call };
}

/** Replaces the article's entities (rank = order) and marks it done, in one transaction. */
export async function persistEntities(sql: Sql, articleId: number, entities: Entity[]): Promise<void> {
	await sql.begin(async (tx) => {
		const ids = new Map<string, number>();
		if (entities.length > 0) {
			// Sorted so concurrent upserts lock rows in the same order. The no-op update makes
			// RETURNING include existing rows; the first-seen name is kept.
			const rows = [...entities].sort((a, b) => a.kind.localeCompare(b.kind) || a.norm.localeCompare(b.norm)).map(({ kind, name, norm }) => ({ kind, name, norm }));
			const upserted = await tx<{ id: number; kind: string; norm: string }[]>`
				INSERT INTO entities ${tx(rows)}
				ON CONFLICT (kind, norm) DO UPDATE SET norm = EXCLUDED.norm
				RETURNING id, kind, norm`;
			for (const r of upserted) ids.set(`${r.kind}:${r.norm}`, r.id);
		}
		await tx`DELETE FROM article_entities WHERE article_id = ${articleId}`;
		if (entities.length > 0) {
			await tx`INSERT INTO article_entities ${tx(
				entities.map((e, rank) => ({ article_id: articleId, entity_id: ids.get(`${e.kind}:${e.norm}`)!, rank }))
			)}`;
		}
		await tx`UPDATE articles SET entities_at = now() WHERE id = ${articleId}`;
	});
}

export interface EntityJob {
	id: number;
	attempts: number;
}

/** Condition on `articles` for the entity queue (also used for the queue length in stats). */
export function entitiesPending(sql: Sql) {
	return sql`classify_state = 'done' AND entities_at IS NULL AND entities_attempts < ${ENTITY_MAX_ATTEMPTS}
		AND kind <> 'sponsored' AND body_purged_at IS NULL
		AND published_at > now() - make_interval(days => ${BACKFILL_DAYS})`;
}

/** Newest pending article first: today's articles get their entities before the backfill. */
export async function nextEntityJob(sql: Sql, exclude: number[]): Promise<EntityJob | null> {
	const [row] = await sql<EntityJob[]>`
		SELECT id, entities_attempts AS attempts FROM articles
		WHERE ${entitiesPending(sql)} AND id <> ALL(${exclude}::bigint[])
		ORDER BY published_at DESC
		LIMIT 1`;
	return row ?? null;
}

async function recordCall(sql: Sql, row: { articleId: number; model: string; ok: boolean; latencyMs: number; input?: number | null; output?: number | null; cached?: number | null; error?: string }) {
	await sql`
		INSERT INTO llm_calls (article_id, purpose, model, ok, latency_ms, input_tokens, output_tokens, cache_read_tokens, error)
		VALUES (${row.articleId}, 'entities', ${row.model}, ${row.ok}, ${row.latencyMs}, ${row.input ?? null}, ${row.output ?? null}, ${row.cached ?? null}, ${row.error ?? null})`;
}

export type EntityOutcome = 'done' | 'retry' | 'failed' | 'paused' | 'gone';

/** Extracts and stores one article's entities. Throws only on database errors. */
export async function processEntities(sql: Sql, config: LlmConfig, job: EntityJob, model = ENTITY_MODEL): Promise<EntityOutcome> {
	const [article] = await sql<{ title: string; teaser: string | null; body: Block[]; outlet: string }[]>`
		SELECT a.title, a.teaser, a.body, o.name AS outlet
		FROM articles a JOIN outlets o ON o.id = a.outlet_id
		WHERE a.id = ${job.id} AND a.body IS NOT NULL AND a.body_purged_at IS NULL`;
	if (!article) {
		// Purged or bodiless: nothing to read, so nothing to extract.
		await sql`UPDATE articles SET entities_at = now() WHERE id = ${job.id}`;
		return 'gone';
	}
	const started = Date.now();
	let result: EntityExtraction;
	try {
		result = await extractEntities(config, { outlet: article.outlet, title: article.title, lead: article.teaser, blocks: article.body }, model);
	} catch (e) {
		const latencyMs = Date.now() - started;
		const error = errorText(e);
		await recordCall(sql, { articleId: job.id, model, ok: false, latencyMs, error });
		if (e instanceof LlmError && e.permanent) {
			// Auth or quota: an operator must act. Do not burn the article's attempts.
			log.error('entities-paused', { id: job.id, model, error });
			return 'paused';
		}
		const attempts = job.attempts + 1;
		await sql`UPDATE articles SET entities_attempts = ${attempts} WHERE id = ${job.id}`;
		const outcome = attempts >= ENTITY_MAX_ATTEMPTS ? 'failed' : 'retry';
		log.warn(`entities-${outcome}`, { id: job.id, attempts, ms: latencyMs, error });
		return outcome;
	}
	const { call, entities } = result;
	await recordCall(sql, { articleId: job.id, model: call.model, ok: true, latencyMs: call.latencyMs, input: call.inputTokens, output: call.outputTokens, cached: call.cacheReadTokens });
	await persistEntities(sql, job.id, entities);
	log.info('entities', { id: job.id, model: call.model, ms: call.latencyMs, in: call.inputTokens, out: call.outputTokens, count: entities.length });
	return 'done';
}
