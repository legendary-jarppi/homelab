// This browser's push subscription, from the page's script (+page.svelte):
//   PUT    { endpoint, keys: { p256dh, auth } }   add or refresh
//   DELETE { endpoint }                           forget (after unsubscribing)
// JSON only: a cross-site page cannot send that without a CORS preflight, which is never granted.
import { error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { deviceLabel, removeDevice, saveDevice } from '$lib/server/notify';
import type { RequestHandler } from './$types';

async function body(request: Request): Promise<Record<string, unknown>> {
	if (!request.headers.get('content-type')?.startsWith('application/json')) error(415, 'Expected JSON');
	const b = (await request.json().catch(() => null)) as Record<string, unknown> | null;
	if (!b || typeof b.endpoint !== 'string' || !/^https:\/\//.test(b.endpoint) || b.endpoint.length > 1000) error(400, 'Bad endpoint');
	return b;
}

export const PUT: RequestHandler = async ({ request, locals }) => {
	const b = await body(request);
	const keys = b.keys as { p256dh?: unknown; auth?: unknown } | undefined;
	if (typeof keys?.p256dh !== 'string' || typeof keys.auth !== 'string') error(400, 'Bad keys');
	await saveDevice(
		db(),
		locals.user.id,
		{ endpoint: b.endpoint as string, keys: { p256dh: keys.p256dh, auth: keys.auth } },
		deviceLabel(request.headers.get('user-agent'))
	);
	return new Response(null, { status: 204 });
};

export const DELETE: RequestHandler = async ({ request, locals }) => {
	const b = await body(request);
	await removeDevice(db(), locals.user.id, { endpoint: b.endpoint as string });
	return new Response(null, { status: 204 });
};
