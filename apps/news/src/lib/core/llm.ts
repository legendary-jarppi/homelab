// Anthropic Messages API client (through the AI proxy) with JSON-schema structured output.
import { setTimeout as sleep } from 'node:timers/promises';
import { z } from 'zod';

/** The parts of an Anthropic Messages response this client reads. */
const MessagesResponse = z.object({
	model: z.string().optional(),
	stop_reason: z.string().nullable().optional(),
	content: z.array(z.object({ type: z.string(), text: z.string().optional() })),
	usage: z
		.object({
			input_tokens: z.number().optional(),
			output_tokens: z.number().optional(),
			cache_read_input_tokens: z.number().nullable().optional()
		})
		.optional()
});

export interface LlmConfig {
	baseUrl: string;
	apiKey: string;
	model: string;
	timeoutMs: number;
	maxAttempts: number;
}

export function llmConfigFromEnv(): LlmConfig {
	const apiKey = process.env.LLM_API_KEY;
	if (!apiKey) throw new Error('LLM_API_KEY is not set');
	return {
		baseUrl: process.env.LLM_BASE_URL ?? 'https://api.proxy.ai.supercell.dev/v1',
		apiKey,
		// Chosen by docs/benchmark.md: fastest measured, about half the under-calls of claude-sonnet-5.
		model: process.env.LLM_MODEL ?? 'claude-sonnet-5-5',
		timeoutMs: Number(process.env.LLM_TIMEOUT_MS ?? 90_000),
		maxAttempts: Number(process.env.LLM_MAX_ATTEMPTS ?? 4)
	};
}

export type ContentBlock =
	| { type: 'text'; text: string }
	| { type: 'image'; source: { type: 'base64'; media_type: 'image/jpeg' | 'image/png' | 'image/webp'; data: string } };

export interface StructuredRequest {
	system: string;
	content: ContentBlock[];
	schema: object;
	maxTokens: number;
	model?: string;
}

export interface StructuredResponse {
	json: unknown;
	model: string;
	latencyMs: number;
	inputTokens: number | null;
	outputTokens: number | null;
	cacheReadTokens: number | null;
}

export class LlmError extends Error {
	/** auth/quota problems need an operator; retrying will not help. */
	readonly permanent: boolean;
	constructor(message: string, permanent: boolean) {
		super(message);
		this.permanent = permanent;
	}
}

/** One structured-output call with bounded exponential backoff on 429/5xx/network errors. */
export async function structured(config: LlmConfig, request: StructuredRequest): Promise<StructuredResponse> {
	const model = request.model ?? config.model;
	const body = JSON.stringify({
		model,
		max_tokens: request.maxTokens,
		// The system prompt (taxonomy and rules) is identical across articles: cache it.
		system: [{ type: 'text', text: request.system, cache_control: { type: 'ephemeral' } }],
		messages: [{ role: 'user', content: request.content }],
		output_config: { format: { type: 'json_schema', schema: request.schema } }
	});
	let lastError = '';
	for (let attempt = 1; attempt <= config.maxAttempts; attempt++) {
		const started = Date.now();
		let response: Response;
		try {
			response = await fetch(`${config.baseUrl}/messages`, {
				method: 'POST',
				headers: { 'x-api-key': config.apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
				body,
				signal: AbortSignal.timeout(config.timeoutMs)
			});
		} catch (e) {
			lastError = `network: ${(e as Error).message}`;
			await sleep(2 ** attempt * 1000);
			continue;
		}
		const text = await response.text();
		if (response.status === 401 || response.status === 403) throw new LlmError(`auth failed (${response.status})`, true);
		if (response.status === 429 || response.status >= 500) {
			lastError = `HTTP ${response.status}: ${text.slice(0, 200)}`;
			const retryAfter = Number(response.headers.get('retry-after'));
			await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 2 ** attempt * 1000);
			continue;
		}
		if (!response.ok) throw new LlmError(`HTTP ${response.status}: ${text.slice(0, 300)}`, response.status === 402);
		const parsed = MessagesResponse.safeParse(JSON.parse(text) as unknown);
		if (!parsed.success) {
			lastError = `unexpected response shape: ${text.slice(0, 120)}`;
			continue;
		}
		const data = parsed.data;
		if (data.stop_reason === 'max_tokens') {
			lastError = 'output truncated at max_tokens';
			continue;
		}
		const out = data.content.filter((c) => c.type === 'text').map((c) => c.text ?? '').join('');
		let json: unknown;
		try {
			json = JSON.parse(out);
		} catch {
			lastError = `malformed JSON output: ${out.slice(0, 120)}`;
			continue;
		}
		return {
			json,
			model: data.model ?? model,
			latencyMs: Date.now() - started,
			inputTokens: data.usage?.input_tokens ?? null,
			outputTokens: data.usage?.output_tokens ?? null,
			cacheReadTokens: data.usage?.cache_read_input_tokens ?? null
		};
	}
	throw new LlmError(`gave up after ${config.maxAttempts} attempts: ${lastError}`, false);
}
