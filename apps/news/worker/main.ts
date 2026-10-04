// Background worker: discovery → extraction (+ photos) → classification → embedding/clustering,
// plus edition rows. Single instance (Postgres advisory lock); coordination with the web app's
// admin actions happens only through article/outlet columns (see DESIGN.md).
//
// Environment (defaults in brackets):
//   DATABASE_URL                 Postgres connection string (required)
//   LLM_API_KEY                  AI proxy key (required); LLM_BASE_URL, LLM_MODEL, LLM_TIMEOUT_MS,
//                                LLM_MAX_ATTEMPTS: see src/lib/core/llm.ts
//   IMAGE_DIR                    photo store [./.cache/images]
//   WORKER_HEALTH_PORT           GET /healthz [9000]
//   HEALTH_MAX_AGE_S             loops must have ticked within this many seconds [600]
//   DISCOVERY_MAX_AGE_H          ignore discovered items older than this [72]
//   CONTENT_CONCURRENCY          parallel extractions [4]; CONTENT_PER_OUTLET in flight per outlet [2]
//   CONTENT_MAX_ATTEMPTS         transient extraction failures before 'failed' [5]
//   CONTENT_MIN_CHARS            shorter bodies are 'skipped' [300]
//   CLASSIFY_CONCURRENCY         parallel model calls [4]
//   CLASSIFY_MAX_ATTEMPTS        failed classifications before 'failed' [5]
//   CLASSIFY_PAUSE_S             pause after an auth/quota error [600]
//   CLASSIFY_MAX_IMAGES          photos sent per article [8] (classify.ts)
//   EMBEDDING_MODEL              [text-embedding-3-small]; CLUSTER_THRESHOLD cosine [see clustering.ts]
//   EDITIONS, EDITION_TIME_ZONE  edition slots (editions.ts)
//   CRAWL_MIN_INTERVAL_MS, CRAWLER_USER_AGENT, CRAWLER_FROM: see src/lib/core/http.ts
//   DB_POOL                      Postgres pool size [10]
import { createServer } from 'node:http';
import type { ReservedSql } from 'postgres';
import { setTimeout as sleep } from 'node:timers/promises';
import { db, migrate } from '../src/lib/core/db.ts';
import { ensureEdition } from '../src/lib/core/editions.ts';
import { llmConfigFromEnv } from '../src/lib/core/llm.ts';
import { OUTLETS, seedOutlets } from '../src/lib/core/outlets/index.ts';
import { initSessions } from '../src/lib/core/sessions.ts';
import { nextClassifyJob, processClassify, type ClassifyJob } from '../src/lib/core/pipeline/classification.ts';
import { EMBEDDING_MODEL, embedPending } from '../src/lib/core/pipeline/clustering.ts';
import { nextContentJob, processContent, type ContentJob } from '../src/lib/core/pipeline/content.ts';
import { discoverDue } from '../src/lib/core/pipeline/discovery.ts';
import { errorText, log } from '../src/lib/core/pipeline/log.ts';

const env = (name: string, fallback: number) => Number(process.env[name] ?? fallback);
const HEALTH_PORT = env('WORKER_HEALTH_PORT', 9000);
const HEALTH_MAX_AGE_MS = env('HEALTH_MAX_AGE_S', 600) * 1000;
const CONTENT_CONCURRENCY = env('CONTENT_CONCURRENCY', 4);
const CONTENT_PER_OUTLET = env('CONTENT_PER_OUTLET', 2);
const CLASSIFY_CONCURRENCY = env('CLASSIFY_CONCURRENCY', 4);
const CLASSIFY_PAUSE_MS = env('CLASSIFY_PAUSE_S', 600) * 1000;
const SHUTDOWN_TIMEOUT_MS = 25_000;
/** pg advisory lock key for the single-instance guard (migrations use 4242). */
const LOCK_KEY = 4243;

const sql = db();
const llm = llmConfigFromEnv();
const embeddingConfig = { baseUrl: llm.baseUrl, apiKey: llm.apiKey, model: EMBEDDING_MODEL };
const stop = new AbortController();
let state: 'standby' | 'running' | 'stopping' = 'standby';
const beats: Record<string, number> = {};
let classifyPausedUntil = 0;

/** Sleeps unless shutdown starts first. */
async function pause(ms: number): Promise<void> {
	await sleep(ms, undefined, { signal: stop.signal }).catch(() => {});
}

/**
 * Bounded-concurrency queue: keeps up to `concurrency` jobs in flight, asking `next` for more as
 * slots free up. Stops picking on shutdown and waits for in-flight jobs.
 */
async function runQueue<T extends { id: number }>(
	name: string,
	concurrency: number,
	next: (inFlight: T[]) => Promise<T | null>,
	handle: (job: T) => Promise<void>,
	idleMs = 5000
): Promise<void> {
	const inFlight = new Map<number, { job: T; done: Promise<void> }>();
	while (!stop.signal.aborted) {
		beats[name] = Date.now();
		let job: T | null = null;
		if (inFlight.size < concurrency) {
			try {
				job = await next([...inFlight.values()].map((f) => f.job));
			} catch (e) {
				log.error(`${name}-queue-error`, { error: errorText(e) });
			}
		}
		if (job) {
			const picked = job;
			const done = handle(picked)
				.catch((e) => log.error(`${name}-job-error`, { id: picked.id, error: errorText(e) }))
				.finally(() => inFlight.delete(picked.id));
			inFlight.set(picked.id, { job: picked, done });
			continue;
		}
		await Promise.race([pause(idleMs), ...[...inFlight.values()].map((f) => f.done)]);
	}
	await Promise.allSettled([...inFlight.values()].map((f) => f.done));
}

/** Runs `tick` every `intervalMs` until shutdown; returns the next interval (for backoff). */
async function every(name: string, intervalMs: number, tick: () => Promise<number | void>): Promise<void> {
	let wait = intervalMs;
	while (!stop.signal.aborted) {
		beats[name] = Date.now();
		try {
			wait = (await tick()) ?? intervalMs;
		} catch (e) {
			log.error(`${name}-error`, { error: errorText(e) });
			wait = intervalMs;
		}
		await pause(wait);
	}
}

function contentQueue(): Promise<void> {
	return runQueue<ContentJob>(
		'content',
		CONTENT_CONCURRENCY,
		(inFlight) => {
			const perOutlet: Record<number, number> = {};
			for (const j of inFlight) perOutlet[j.outletId] = (perOutlet[j.outletId] ?? 0) + 1;
			const busy = Object.entries(perOutlet).filter(([, n]) => n >= CONTENT_PER_OUTLET).map(([id]) => Number(id));
			return nextContentJob(sql, inFlight.map((j) => j.id), busy);
		},
		(job) => processContent(sql, job)
	);
}

function classifyQueue(): Promise<void> {
	return runQueue<ClassifyJob>(
		'classify',
		CLASSIFY_CONCURRENCY,
		async (inFlight) => (Date.now() < classifyPausedUntil ? null : nextClassifyJob(sql, inFlight.map((j) => j.id))),
		async (job) => {
			if ((await processClassify(sql, llm, job)) === 'paused') {
				classifyPausedUntil = Date.now() + CLASSIFY_PAUSE_MS;
				log.error('classification-paused', { seconds: CLASSIFY_PAUSE_MS / 1000, hint: 'check LLM_API_KEY / proxy quota' });
			}
		}
	);
}

/** Embedding failures back off up to 30 min; articles stay visible, just unclustered. */
function embedLoop(): Promise<void> {
	const base = 20_000;
	let backoff = base;
	return every('embed', base, async () => {
		try {
			const n = await embedPending(sql, embeddingConfig);
			backoff = base;
			return n > 0 ? 1000 : base;
		} catch (e) {
			backoff = Math.min(backoff * 2, 30 * 60_000);
			log.warn('embed-failed', { retry_s: backoff / 1000, error: errorText(e) });
			return backoff;
		}
	});
}

let lastStats = 0;
async function housekeeping(lock: ReservedSql): Promise<void> {
	// The lock lives on this connection; if it is gone another worker may take over, so stop.
	try {
		await lock`SELECT 1`;
	} catch (e) {
		log.error('lock-lost', { error: errorText(e) });
		process.exitCode = 1;
		shutdown('lock-lost');
		return;
	}
	if (await ensureEdition(sql)) log.info('edition-created');
	if (Date.now() - lastStats >= 5 * 60_000) {
		lastStats = Date.now();
		const [q] = await sql`
			SELECT count(*) FILTER (WHERE content_state = 'pending') AS content_pending,
				count(*) FILTER (WHERE content_state = 'extracted' AND classify_state = 'pending') AS classify_pending,
				count(*) FILTER (WHERE classify_state = 'done') AS classified,
				count(*) FILTER (WHERE classify_state = 'done' AND embedding IS NULL AND kind <> 'sponsored') AS embed_pending
			FROM articles WHERE body_purged_at IS NULL`;
		const [calls] = await sql`
			SELECT count(*) AS calls, count(*) FILTER (WHERE NOT ok) AS errors,
				percentile_cont(0.5) WITHIN GROUP (ORDER BY latency_ms) FILTER (WHERE ok) AS p50_ms,
				sum(input_tokens) AS input_tokens, sum(output_tokens) AS output_tokens
			FROM llm_calls WHERE created_at > now() - interval '1 hour'`;
		log.info('stats', { ...q, llm_calls_1h: calls.calls, llm_errors_1h: calls.errors, llm_p50_ms: calls.p50_ms, input_tokens_1h: calls.input_tokens, output_tokens_1h: calls.output_tokens });
	}
}

function startHealthServer() {
	const server = createServer((req, res) => {
		if (req.url !== '/healthz') {
			res.writeHead(404).end();
			return;
		}
		const now = Date.now();
		const stale = Object.entries(beats).filter(([, at]) => now - at > HEALTH_MAX_AGE_MS).map(([name]) => name);
		const ok = state === 'standby' || (state === 'running' && stale.length === 0);
		res.writeHead(ok ? 200 : 503, { 'content-type': 'application/json' });
		res.end(JSON.stringify({ state, stale, classifyPaused: now < classifyPausedUntil }));
	});
	server.listen(HEALTH_PORT);
	return server;
}

function shutdown(reason: string): void {
	if (stop.signal.aborted) return;
	log.info('shutdown', { reason });
	state = 'stopping';
	stop.abort();
	// In-flight jobs leave no partial state (outcomes are written at the end), so a hard exit is safe.
	setTimeout(() => {
		log.warn('shutdown-timeout', { ms: SHUTDOWN_TIMEOUT_MS });
		process.exit(1);
	}, SHUTDOWN_TIMEOUT_MS).unref();
}

async function main(): Promise<void> {
	const health = startHealthServer();
	process.on('SIGTERM', () => shutdown('SIGTERM'));
	process.on('SIGINT', () => shutdown('SIGINT'));

	const lock = await sql.reserve();
	while (!stop.signal.aborted) {
		const [{ ok }] = await lock`SELECT pg_try_advisory_lock(${LOCK_KEY}) AS ok`;
		if (ok) break;
		log.info('standby', { reason: 'another worker holds the lock' });
		await pause(30_000);
	}
	if (!stop.signal.aborted) {
		state = 'running';
		// Same advisory-locked runner as the web pod: whichever starts first applies new migrations.
		const migrated = await migrate(sql, process.env.MIGRATIONS_DIR ?? 'migrations');
		if (migrated.length > 0) log.info('migrated', { files: migrated.join(',') });
		await seedOutlets(sql);
		const sessions = await initSessions(sql, OUTLETS);
		log.info('started', { model: llm.model, content_concurrency: CONTENT_CONCURRENCY, classify_concurrency: CLASSIFY_CONCURRENCY, health_port: HEALTH_PORT, subscriber_sessions: sessions.join(',') || 'none' });
		await Promise.all([
			every('discovery', 30_000, async () => {
				await discoverDue(sql);
			}),
			contentQueue(),
			classifyQueue(),
			embedLoop(),
			every('housekeeping', 60_000, () => housekeeping(lock))
		]);
	}
	await lock`SELECT pg_advisory_unlock(${LOCK_KEY})`.catch(() => {});
	lock.release();
	await sql.end({ timeout: 5 });
	health.close();
	log.info('stopped');
}

main().catch((e) => {
	log.error('fatal', { error: errorText(e) });
	process.exit(1);
});
