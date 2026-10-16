// The sending API for apps inside the cluster (never routed through the tunnel):
//   POST /api/send   Authorization: Bearer <the sender's token>
//   { "topic": "packages", "title": "…", "body": "…", "url"?: "https://…", "to"?: ["email", …] }
// -> 200 { id, recipients, devices, delivered, failed }. Contract documented in apps/notify/README.md.
import { error, json } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { send, SendError } from '$lib/server/notify';
import { senderFor } from '$lib/server/senders';
import type { RequestHandler } from './$types';

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

export const POST: RequestHandler = async ({ request }) => {
	const sender = await senderFor(request.headers.get('authorization'));
	if (!sender) error(401, 'Unauthorized');

	const b = (await request.json().catch(() => null)) as Record<string, unknown> | null;
	if (!b) error(400, 'Expected a JSON body');
	const topic = str(b.topic, 40);
	const title = str(b.title, 120);
	const body = str(b.body, 1000);
	if (!topic || !title) error(400, 'topic and title are required');
	const url = b.url == null || b.url === '' ? null : str(b.url, 500);
	if (url !== null && !/^https?:\/\//.test(url)) error(400, 'url must be http(s)');
	let to: string[] | undefined;
	if (b.to != null) {
		if (!Array.isArray(b.to) || !b.to.every((e) => typeof e === 'string' && e.includes('@'))) error(400, 'to must be a list of emails');
		to = b.to as string[];
	}

	try {
		return json(await send(db(), { sender, topic, title, body, url, to }));
	} catch (e) {
		if (e instanceof SendError) error(400, e.message);
		throw e;
	}
};
