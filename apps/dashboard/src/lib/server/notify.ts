// Sends through apps/notify's sending API (cluster-internal, bearer token from secret dashboard-notify).
// Without the token nothing is sent. Failures are logged, never thrown: a notification is best effort.
import { config } from '$lib/server/config';

export const notifyConfigured = () => config.notifyToken !== '';

export async function notify(m: { topic: string; title: string; body: string; url?: string }): Promise<void> {
	if (!notifyConfigured()) return;
	try {
		const r = await fetch(`${config.notifyUrl}/api/send`, {
			method: 'POST',
			headers: { authorization: `Bearer ${config.notifyToken}`, 'content-type': 'application/json' },
			body: JSON.stringify(m),
			signal: AbortSignal.timeout(30_000)
		});
		if (!r.ok) console.error(`notify ${m.topic} failed: HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
	} catch (e) {
		console.error(`notify ${m.topic} failed: ${(e as Error).message}`);
	}
}
