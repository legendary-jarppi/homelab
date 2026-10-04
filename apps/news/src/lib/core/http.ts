// The one outbound HTTP client for feeds, article pages and images: robots.txt, per-host pacing,
// identifying User-Agent, timeouts and size caps. Private address ranges are additionally
// blocked for the worker by a NetworkPolicy (deploy/networkpolicy.yaml).
import robotsParser from 'robots-parser';
import { setTimeout as sleep } from 'node:timers/promises';

// No "+http://…" in the UA: npr.org resets connections for UAs containing a URL. The contact
// address goes in the From header instead.
export const USER_AGENT = process.env.CRAWLER_USER_AGENT ?? 'Mozilla/5.0 (compatible; ShillyShallyNews/1.0; private reading service)';
const FROM = process.env.CRAWLER_FROM ?? 'news-crawler@lab.internal';
/** Robots rules are matched against this product token. */
const ROBOTS_AGENT = 'ShillyShallyNews';
const MIN_HOST_INTERVAL_MS = Number(process.env.CRAWL_MIN_INTERVAL_MS ?? 1500);
const ROBOTS_TTL_MS = 6 * 3600_000;

export class FetchError extends Error {
	readonly kind: 'robots' | 'http' | 'network' | 'too-large' | 'protocol';
	readonly status?: number;
	constructor(message: string, kind: FetchError['kind'], status?: number) {
		super(message);
		this.kind = kind;
		this.status = status;
	}
}

export interface FetchResult {
	url: string;
	status: number;
	headers: Headers;
	body: Buffer;
}

export interface GetOptions {
	accept?: string;
	maxBytes?: number;
	timeoutMs?: number;
	/** false: skip the robots.txt check (only for robots-exempt resources such as images on CDNs we already reached). */
	robots?: boolean;
}

/** The part of robots-parser's (unexported) Robot interface this client uses. */
interface RobotsRules {
	isAllowed(url: string, ua?: string): boolean | undefined;
	getCrawlDelay(ua?: string): number | undefined;
}

interface RobotsEntry {
	at: number;
	/** null: no robots.txt (4xx), everything allowed. */
	rules: RobotsRules | null;
	crawlDelayMs: number;
}

const hostNextAt = new Map<string, number>();
const robotsCache = new Map<string, RobotsEntry>();

/** Waits until this host may be requested again; reserves the slot before awaiting. */
async function pace(host: string, minIntervalMs: number): Promise<void> {
	const now = Date.now();
	const at = Math.max(now, hostNextAt.get(host) ?? 0);
	hostNextAt.set(host, at + minIntervalMs);
	if (at > now) await sleep(at - now);
}

async function robotsFor(origin: string): Promise<RobotsEntry> {
	const cached = robotsCache.get(origin);
	if (cached && Date.now() - cached.at < ROBOTS_TTL_MS) return cached;
	const robotsUrl = `${origin}/robots.txt`;
	const disallowAll: RobotsRules = robotsParser(robotsUrl, 'User-agent: *\nDisallow: /');
	let entry: RobotsEntry;
	try {
		await pace(new URL(origin).host, MIN_HOST_INTERVAL_MS);
		const response = await fetch(robotsUrl, { headers: { 'user-agent': USER_AGENT }, signal: AbortSignal.timeout(15_000) });
		if (response.status >= 500) {
			// Server error: treat as "disallow everything" until the next check (RFC 9309).
			entry = { at: Date.now(), rules: disallowAll, crawlDelayMs: 0 };
		} else if (!response.ok) {
			entry = { at: Date.now(), rules: null, crawlDelayMs: 0 };
		} else {
			const rules: RobotsRules = robotsParser(robotsUrl, await response.text());
			entry = { at: Date.now(), rules, crawlDelayMs: (rules.getCrawlDelay(ROBOTS_AGENT) ?? 0) * 1000 };
		}
	} catch {
		// Unreachable robots.txt: disallow, and retry in five minutes rather than caching for hours.
		entry = { at: Date.now() - ROBOTS_TTL_MS + 300_000, rules: disallowAll, crawlDelayMs: 0 };
	}
	robotsCache.set(origin, entry);
	return entry;
}

/**
 * GET with robots.txt, pacing, a total timeout and a body size cap.
 * Throws FetchError; HTTP errors carry the status.
 */
export async function get(url: string, options: GetOptions = {}): Promise<FetchResult> {
	const parsed = new URL(url);
	if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new FetchError(`unsupported protocol ${parsed.protocol}`, 'protocol');
	const { rules, crawlDelayMs } = await robotsFor(parsed.origin);
	if (options.robots !== false && rules && rules.isAllowed(url, ROBOTS_AGENT) === false) {
		throw new FetchError(`disallowed by robots.txt: ${url}`, 'robots');
	}
	await pace(parsed.host, Math.max(MIN_HOST_INTERVAL_MS, crawlDelayMs));

	let response: Response;
	try {
		response = await fetch(url, {
			headers: { 'user-agent': USER_AGENT, from: FROM, accept: options.accept ?? '*/*', 'accept-language': 'fi,en;q=0.8' },
			redirect: 'follow',
			signal: AbortSignal.timeout(options.timeoutMs ?? 30_000)
		});
	} catch (e) {
		throw new FetchError(`network error for ${url}: ${(e as Error).message}`, 'network');
	}
	if (!response.ok) {
		await response.body?.cancel();
		throw new FetchError(`HTTP ${response.status} for ${url}`, 'http', response.status);
	}
	const maxBytes = options.maxBytes ?? 8 * 1024 * 1024;
	const declared = Number(response.headers.get('content-length') ?? 0);
	if (declared > maxBytes) {
		await response.body?.cancel();
		throw new FetchError(`response too large (${declared} bytes) for ${url}`, 'too-large');
	}
	const chunks: Uint8Array[] = [];
	let total = 0;
	for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
		total += chunk.byteLength;
		if (total > maxBytes) throw new FetchError(`response exceeded ${maxBytes} bytes for ${url}`, 'too-large');
		chunks.push(chunk);
	}
	return { url: response.url || url, status: response.status, headers: response.headers, body: Buffer.concat(chunks) };
}

export async function getText(url: string, options: GetOptions = {}): Promise<{ url: string; text: string }> {
	const result = await get(url, options);
	return { url: result.url, text: result.body.toString('utf8') };
}
