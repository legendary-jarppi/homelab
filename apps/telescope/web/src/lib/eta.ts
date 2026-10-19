import type { Live, SessionDetail } from './types';

/**
 * Estimated end (unix s) of the current target and of the whole plan: the remaining frames × the session's
 * average frame cadence so far (first to last frame, so meridian flips and refocusing count in), from the
 * last frame. Null when nothing is running or there is not enough to go on.
 */
export function estimateFinish(session: SessionDetail | null, live: Live | null): { target: number | null; plan: number | null; cadenceS: number | null } {
	const none = { target: null, plan: null, cadenceS: null };
	if (!session?.active) return none;
	const count = session.frames.length + (session.pending ?? 0);
	if (count < 2) return none;
	const cadenceS = (session.lastFrameAt - session.firstFrameAt) / (count - 1);
	const end = (remaining: number | null) => (remaining !== null && remaining > 0 ? session.lastFrameAt + remaining * cadenceS + (session.exposureS ?? 0) : null);
	const p = live?.plan;
	const targetLeft = p?.targetTotal != null && p.targetDone != null ? p.targetTotal - p.targetDone : session.plan?.planned != null && session.plan.current != null ? session.plan.planned - session.plan.current : null;
	const planLeft = p?.planTotal != null && p.planDone != null && (p.targets ?? 1) > 1 ? p.planTotal - p.planDone : null;
	return { target: end(targetLeft), plan: end(planLeft), cadenceS };
}
