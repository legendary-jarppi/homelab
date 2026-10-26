import { error } from '@sveltejs/kit';
import { focusAnalysis } from '$lib/server/advice';
import { upstreamJson } from '$lib/server/telescope';
import type { FocusReport, Frame, SessionDetail, SessionSummary } from '$lib/types';
import type { PageServerLoad } from './$types';

/**
 * A5: every archived auto focus run, and the frames (time, HFR) of the nights with two successful runs or more,
 * for the HFR drift between runs (one session report per such session, fetched in parallel). R6: the focus
 * advice and what it rests on (advice.ts, at most 10 min old).
 */
export const load: PageServerLoad = async () => {
	const [focus, sessions, analysis] = await Promise.all([upstreamJson<FocusReport>('/api/focus', 'telescope', 15_000), upstreamJson<SessionSummary[]>('/api/sessions', 'telescope'), focusAnalysis()]);
	if (!focus || !sessions) error(502, 'Telescope service unavailable.');
	const perNight: Record<string, number> = {};
	for (const r of focus.runs) if (r.success && r.night) perNight[r.night] = (perNight[r.night] ?? 0) + 1;
	const wanted = sessions.filter((s) => (perNight[s.night] ?? 0) >= 2);
	const details = await Promise.all(wanted.map((s) => upstreamJson<SessionDetail>(`/api/sessions/${encodeURIComponent(s.id)}`, 'telescope', 15_000)));
	const frames: (Pick<Frame, 'at' | 'exposureS' | 'hfr' | 'accepted'> & { night: string })[] = details.flatMap((d) =>
		d ? d.frames.map((f) => ({ at: f.at, exposureS: f.exposureS, hfr: f.hfr, accepted: f.accepted, night: d.night })) : []
	);
	return { focus, frames, missing: details.filter((d) => !d).length, analysis };
};
