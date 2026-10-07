// Home/away per person from sightings. Home as soon as any source sees one of the person's devices;
// away once no source has seen them for `awayAfterS`. The away decision runs when the Wi-Fi poll
// answers (evaluate), so a Prometheus outage freezes the state instead of sending everyone away;
// Bluetooth sightings only ever bring people home or keep them there.
import type { Person } from './config.ts';

/** wifi: UniFi clients via Prometheus; ble: ESPresense nodes via MQTT. */
export type Source = 'wifi' | 'ble';

export interface PersonState {
	/** null until a source has answered at least once. */
	home: boolean | null;
	/** Unix seconds: home since (first sighting), or away since (last sighting); null if unknown. */
	since: number | null;
	lastSeen: number | null;
	/** Source of the latest sighting. */
	via: Source | null;
}

export interface SourceState {
	ok: boolean;
	lastOk: number | null;
	error: string | null;
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
		for (const p of people) this.state.set(p.id, { home: null, since: null, lastSeen: null, via: null });
	}

	/**
	 * Rebuild a person's state from past sightings (unix seconds, any order): home if seen within
	 * `awayAfterS` of `nowS`, since the start of that run of sightings (gaps up to `awayAfterS` do not
	 * break it); otherwise away since the last sighting. A run reaching back to `historyStart` (the
	 * first data there is) began earlier at an unknown time: since stays null.
	 */
	restore(personId: string, seenAt: number[], via: Source, nowS: number, historyStart: number | null): void {
		const times = [...seenAt].sort((a, b) => a - b);
		const last = times.at(-1);
		const s = this.get(personId);
		if (last === undefined) return;
		s.lastSeen = last;
		s.via = via;
		if (nowS - last > this.awayAfterS) {
			s.home = false;
			s.since = last;
			return;
		}
		let start = last;
		for (let i = times.length - 2; i >= 0 && start - times[i] <= this.awayAfterS; i--) start = times[i];
		s.home = true;
		s.since = historyStart !== null && start - historyStart <= this.awayAfterS ? null : start;
	}

	/** One of the person's devices was seen at `atS`. */
	sighting(personId: string, source: Source, atS: number): void {
		const s = this.get(personId);
		if (s.lastSeen !== null && atS < s.lastSeen) return;
		s.lastSeen = atS;
		s.via = source;
		if (s.home !== true) this.set(personId, { home: true, since: atS });
	}

	/** Away decisions at `nowS`, when the judging source (Wi-Fi) has just answered. */
	evaluate(nowS: number): void {
		for (const p of this.people) {
			const s = this.get(p.id);
			if (s.home === null) {
				// First answer and not seen, no history: away, since unknown.
				this.set(p.id, { home: false, since: s.lastSeen });
			} else if (s.home && s.lastSeen !== null && nowS - s.lastSeen > this.awayAfterS) {
				this.set(p.id, { home: false, since: s.lastSeen });
			}
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

	private set(id: string, change: Pick<PersonState, 'home' | 'since'>): void {
		const person = this.people.find((p) => p.id === id);
		if (!person) throw new Error(`unknown person ${id}`);
		Object.assign(this.get(id), change);
		this.onChange(person, this.get(id));
	}
}
