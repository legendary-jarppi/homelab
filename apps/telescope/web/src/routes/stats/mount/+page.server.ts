import { error } from '@sveltejs/kit';
import { upstreamJson } from '$lib/server/telescope';
import type { GuideLogDetail, GuideLogSummary } from '$lib/types';
import type { PageServerLoad } from './$types';

/** A guide log's file stem: PHD2_GuideLog_<date>_<time>. */
const GUIDELOG = /^PHD2_GuideLog_[0-9_-]{1,40}$/;

/** D7: the archived PHD2 guide logs and the analysis of the one in ?log= (else the newest). */
export const load: PageServerLoad = async ({ url }) => {
	const logs = await upstreamJson<GuideLogSummary[]>('/api/guidelogs', 'telescope', 60_000);
	if (!logs) error(502, 'Telescope service unavailable.');
	const wanted = url.searchParams.get('log');
	const id = wanted && GUIDELOG.test(wanted) && logs.some((g) => g.id === wanted) ? wanted : (logs[0]?.id ?? null);
	const log = id ? await upstreamJson<GuideLogDetail>(`/api/guidelogs/${id}`, 'telescope', 30_000) : null;
	return { logs, log };
};
