import { error, json } from '@sveltejs/kit';
import { config } from '$lib/server/config';
import { previewDigest } from '$lib/server/digest';
import { reason } from '$lib/server/scheduler';
import { NIGHT } from '$lib/server/telescope';
import type { RequestHandler } from './$types';

/** R6: what tonight's pick or a night's morning report would say now (never sends). `?kind=pick|report&night=YYYY-MM-DD`. */
export const GET: RequestHandler = async ({ url }) => {
	const kind = url.searchParams.get('kind');
	if (kind !== 'pick' && kind !== 'report') error(400, 'kind must be pick or report');
	const night = url.searchParams.get('night') ?? undefined;
	if (night !== undefined && !NIGHT.test(night)) error(400, 'night must be YYYY-MM-DD');
	if (!config.site) error(404, 'Site not configured');
	try {
		return json(await previewDigest(kind, night), { headers: { 'cache-control': 'no-store' } });
	} catch (e) {
		return json({ message: reason(e) }, { status: 502, headers: { 'cache-control': 'no-store' } });
	}
};
