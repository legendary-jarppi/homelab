// C5: accepted integration per target across every session. A session belongs to the catalog object its
// ASIAIR target name names ("NGC 7000", "M31", "Sh2-155"), else to the nearest one within MATCH_DEG of its
// plate-solved RA/Dec; sessions matching nothing stay under their own target name. Goals and the
// wishlist are keyed the same way (the catalog id, else the target name) in the service's target store.
import { catalog, findDso, separation, type Dso } from './catalog';
import type { SessionSummary, TargetGoal } from './types';

/** How far a session's centre may be from a catalog object's centre to count for it, degrees. */
export const MATCH_DEG = 0.3;
/** The service's key rule for the target store. */
export const KEY = /^[A-Za-z0-9 +._()-]{1,64}$/;

/** A target name as a store key: other characters become "_", at most 64. */
export const targetKey = (name: string) => name.trim().replace(/[^A-Za-z0-9 +._()-]/g, '_').slice(0, 64) || '_';

export interface TargetProgress {
	/** Goal store key: the catalog id, or the session target name. */
	key: string;
	dso: Dso | null;
	/** ASIAIR target names seen (the most used first): what a final stack is built for. */
	targetNames: string[];
	sessions: SessionSummary[];
	integrationS: number;
	nights: string[];
	lastNight: string | null;
	/** Where the sessions pointed (the newest with coordinates), or the catalog's position. */
	ra: number | null;
	dec: number | null;
	goal: TargetGoal | null;
}

/** The catalog object a session is of, or null. */
export function sessionDso(s: Pick<SessionSummary, 'target' | 'ra' | 'dec'>): Dso | null {
	const named = findDso(s.target);
	if (named) return named;
	if (s.ra === null || s.ra === undefined || s.dec === null || s.dec === undefined) return null;
	let nearest: Dso | null = null;
	let distance = MATCH_DEG;
	for (const o of catalog) {
		if (Math.abs(o.dec - s.dec) > MATCH_DEG) continue;
		const d = separation(o.ra, o.dec, s.ra, s.dec);
		if (d <= distance) {
			nearest = o;
			distance = d;
		}
	}
	return nearest;
}

/** The goal store key for a session's target. */
export const sessionKey = (s: Pick<SessionSummary, 'target' | 'ra' | 'dec'>) => targetKey(sessionDso(s)?.id ?? s.target);

/** Every imaged target and every target with a goal or on the wishlist, most integration first. */
export function progressByTarget(sessions: SessionSummary[], goals: Record<string, TargetGoal>): TargetProgress[] {
	const out = new Map<string, TargetProgress>();
	const entry = (key: string, dso: Dso | null): TargetProgress => {
		let p = out.get(key);
		if (!p) {
			p = { key, dso, targetNames: [], sessions: [], integrationS: 0, nights: [], lastNight: null, ra: dso?.ra ?? null, dec: dso?.dec ?? null, goal: goals[key] ?? null };
			out.set(key, p);
		}
		return p;
	};
	// Oldest first, so the newest session's coordinates win.
	for (const s of [...sessions].sort((a, b) => a.firstFrameAt - b.firstFrameAt)) {
		const dso = sessionDso(s);
		const p = entry(targetKey(dso?.id ?? s.target), dso);
		p.sessions.push(s);
		p.integrationS += s.integrationS;
		if (!p.nights.includes(s.night)) p.nights.push(s.night);
		p.lastNight = s.night;
		if (!dso && s.ra !== null && s.ra !== undefined && s.dec !== null && s.dec !== undefined) {
			p.ra = s.ra;
			p.dec = s.dec;
		}
	}
	for (const p of out.values()) {
		const counts = new Map<string, number>();
		for (const s of p.sessions) counts.set(s.target, (counts.get(s.target) ?? 0) + 1);
		p.targetNames = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name);
	}
	for (const [key, goal] of Object.entries(goals)) if (!out.has(key) && (goal.goalHours !== null || goal.wishlist)) entry(key, findDso(key));
	return [...out.values()].sort((a, b) => b.integrationS - a.integrationS || a.key.localeCompare(b.key));
}

/** Integration per catalog id (for the planner's rows). */
export function integrationById(sessions: SessionSummary[]): Map<string, number> {
	const out = new Map<string, number>();
	for (const s of sessions) {
		const id = sessionDso(s)?.id;
		if (id) out.set(id, (out.get(id) ?? 0) + s.integrationS);
	}
	return out;
}
