// Push notifications through apps/notify (POST /api/send, cluster-internal, bearer token of the sender
// `telescope-web`). One attempt per call; the digest scheduler decides about trying again later.
import { config } from './config';

/** apps/notify's topic for the digests (apps/notify/deploy/topics.json). */
export const DIGEST_TOPIC = 'telescope-digest';
const SEND_TIMEOUT_MS = 15_000;
/** apps/notify's limits for a message. */
const TITLE_MAX = 120;
export const BODY_MAX = 1000;

export interface Message {
	title: string;
	body: string;
	url: string;
}

let warnedNoToken = false;

/** Whether a token is configured; logs once when it is not. */
export function notifyConfigured(): boolean {
	if (config.notifyToken && config.notifyUrl) return true;
	if (!warnedNoToken) {
		warnedNoToken = true;
		console.log(`notify: ${config.notifyToken ? 'NOTIFY_URL' : 'NOTIFY_TOKEN'} not set, digests are composed but not sent`);
	}
	return false;
}

const clip = (text: string, max: number) => (text.length <= max ? text : `${text.slice(0, max - 1)}…`);

/** Send on the digest topic. Throws with the reason when apps/notify does not take it. */
export async function sendDigest(message: Message): Promise<{ recipients: number; delivered: number }> {
	const response = await fetch(`${config.notifyUrl}/api/send`, {
		method: 'POST',
		headers: { authorization: `Bearer ${config.notifyToken}`, 'content-type': 'application/json' },
		body: JSON.stringify({ topic: DIGEST_TOPIC, title: clip(message.title, TITLE_MAX), body: clip(message.body, BODY_MAX), url: message.url }),
		signal: AbortSignal.timeout(SEND_TIMEOUT_MS)
	});
	const text = await response.text();
	if (!response.ok) throw new Error(`notify: HTTP ${response.status} ${text.slice(0, 200)}`);
	const answer = JSON.parse(text) as { recipients?: number; delivered?: number };
	return { recipients: answer.recipients ?? 0, delivered: answer.delivered ?? 0 };
}
