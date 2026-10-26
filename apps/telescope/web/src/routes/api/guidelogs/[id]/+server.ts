import { error } from '@sveltejs/kit';
import { proxyJson } from '$lib/server/telescope';
import type { RequestHandler } from './$types';

/** A guide log's file stem: PHD2_GuideLog_<date>_<time>. */
const GUIDELOG = /^PHD2_GuideLog_[0-9_-]{1,40}$/;

/** D7: one guide log's sections, periodic error, Dec drift, backlash and chart series. */
export const GET: RequestHandler = ({ params }) => {
	if (!GUIDELOG.test(params.id)) error(404, 'Not a guide log');
	return proxyJson(`/api/guidelogs/${params.id}`, {}, 30_000);
};
