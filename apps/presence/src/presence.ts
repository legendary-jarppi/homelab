// Where each person is, from sightings: at a site (home, the cabin, …) as soon as a source sees one
// of their devices there; away once nothing has seen them for `awayAfterS`, but only when the site
// they were last at is reporting. A site whose data stopped coming (the cabin's mobile link or the
// VPN down) cannot tell whether someone left, so they stay there, marked stale, until it reports
// again or they are seen elsewhere. The away decisions run when the Wi-Fi poll answers (evaluate),
// so a Prometheus outage freezes everyone; Bluetooth sightings only ever bring people to the site
// whose nodes saw them or keep them there.
import type { Person } from './config.ts';

/** wifi: UniFi clients via Prometheus; ble: ESPresense nodes via MQTT. */
export type Source = 'wifi' | 'ble';

export const AWAY = 'away';

export interface PersonState {
	/** A site id or AWAY; null until a source has answered. */
	place: string | null;
	/** Unix seconds: at `place` since (first sighting there), or away since (last sighting); null if unknown. */
	since: number | null;
	lastSeen: number | null;
	/** Site and source of the latest sighting. */
	lastSite: string | null;
	via: Source | null;
	/** At a site that is not reporting right now: as far as anyone knows. */
	stale: boolean;
}

export interface SourceState {
	ok: boolean;
	lastOk: number | null;
	error: string | null;
}

/** One sighting from history: when and at which site. */
export interface Seen {
	at: number;
	site: string;
}

export class Presence {
	readonly state = new Map<string, PersonState>();
	/** Only the configured sources. */
	readonly sources: Partial<Record<Source, SourceState>> = {};
	readonly people: Person[];
	readonly awayAfterS: number;
	private readonly onChange: (person: Person, state: PersonState) => void;

	constructor(people: Person[], sources: Source[], awayAfterS: number, onChange: (person: Person, state: PersonState) => void = () => {}) {
		this.people = people;
		this.awayAfterS = awayAfterS;
		this.onChange = onChange;
		for (const s of sources) this.sources[s] = { ok: false, lastOk: null, error: null };
		for (const p of people) this.state.set(p.id, { place: null, since: null, lastSeen: null, lastSite: null, via: null, stale: false });
	}

	/**
	 * Rebuild a person's state from past sightings (any order). At the site of the last sighting if
	 * that was within `awayAfterS` of `nowS`, or if that site has had no data since (`siteDataUntil`,
	 * its last minute with any data); since the start of the run of sightings there (gaps up to
	 * `awayAfterS` do not break it). Otherwise away since the last sighting. A run reaching back to
	 * the site's first data (`siteDataFrom`) began at an unknown time: since stays null.
	 */
	restore(personId: string, seen: Seen[], via: Source, nowS: number, siteDataFrom: Map<string, number>, siteDataUntil: Map<string, number>): void {
		const runs = [...seen].sort((a, b) => a.at - b.at);
		const last = runs.at(-1);
		const s = this.get(personId);
		if (last === undefined) return;
		s.lastSeen = last.at;
		s.lastSite = last.site;
		s.via = via;
		const siteSilent = nowS - (siteDataUntil.get(last.site) ?? 0) > this.awayAfterS;
		if (nowS - last.at > this.awayAfterS && !siteSilent) {
			s.place = AWAY;
			s.since = last.at;
			return;
		}
		let start = last.at;
		for (let i = runs.length - 2; i >= 0 && runs[i].site === last.site && start - runs[i].at <= this.awayAfterS; i--) start = runs[i].at;
		const from = siteDataFrom.get(last.site);
		s.place = last.site;
		s.since = from !== undefined && start - from <= this.awayAfterS ? null : start;
		s.stale = siteSilent;
	}

	/** One of the person's devices was seen at `site` at `atS`. */
	sighting(personId: string, site: string, source: Source, atS: number): void {
		const s = this.get(personId);
		if (s.lastSeen !== null && atS < s.lastSeen) return;
		s.lastSeen = atS;
		s.lastSite = site;
		s.via = source;
		if (s.place !== site) this.set(personId, { place: site, since: atS, stale: false });
	}

	/** Away decisions at `nowS`, when the judging source (Wi-Fi) has just answered; `reporting`: sites with data now. */
	evaluate(nowS: number, reporting: Set<string>): void {
		for (const p of this.people) {
			const s = this.get(p.id);
			if (s.place === null) {
				// First answer and not seen, no history: away, since unknown.
				this.set(p.id, { place: AWAY, since: s.lastSeen, stale: false });
				continue;
			}
			if (s.place === AWAY) continue;
			const ok = reporting.has(s.place);
			if (ok && s.lastSeen !== null && nowS - s.lastSeen > this.awayAfterS) this.set(p.id, { place: AWAY, since: s.lastSeen, stale: false });
			else s.stale = !ok;
		}
	}

	answered(source: Source, atS: number): void {
		this.sources[source] = { ok: true, lastOk: atS, error: null };
	}

	failed(source: Source, error: string): void {
		const prev = this.sources[source];
		this.sources[source] = { ok: false, lastOk: prev?.lastOk ?? null, error };
	}

	private get(id: string): PersonState {
		const s = this.state.get(id);
		if (!s) throw new Error(`unknown person ${id}`);
		return s;
	}

	private set(id: string, change: Pick<PersonState, 'place' | 'since' | 'stale'>): void {
		const person = this.people.find((p) => p.id === id);
		if (!person) throw new Error(`unknown person ${id}`);
		Object.assign(this.get(id), change);
		this.onChange(person, this.get(id));
	}
}
