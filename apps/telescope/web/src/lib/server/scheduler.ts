// R6: when the digests go out. Pure scheduling logic (everything it touches comes in as `deps`), wired up in
// digest.ts. Every tick, for tonight's pick and last night's report:
//  - inside the slot's window only: from its time (DIGEST_PICK_AT; DIGEST_REPORT_AT or an hour after the
//    night's last frame, whichever is later) to DIGEST_WINDOW_MIN after it; a slot missed (pod down) is skipped;
//  - a night not worth a message (cloudy, no frames) is decided once and logged, not sent;
//  - sent-marker first: the service's GET /api/notices/<key>; an answer other than "sent" or "not sent"
//    (the service unreachable) means no send this tick: better a missed message than a duplicate;
//  - one send per tick at most; a failed send is tried at the next tick until the window closes;
//  - after a send the marker is PUT; when that fails it is PUT again at the next ticks (never a second send).
export type DigestKind = 'pick' | 'report';

export interface Composed {
	send: boolean;
	reason: string | null;
	title: string;
	body: string;
	url: string;
	/** Unix s; null while the night's imaging is still running (report). */
	dueAt: number | null;
}

export interface SchedulerDeps {
	/** Unix ms. */
	now(): number;
	/** Local date "YYYY-MM-DD" of an instant, the instant of a local time (minutes after midnight) on a date, the date before. */
	localDate(ms: number): string;
	localTime(date: string, minutes: number): number;
	previousDate(date: string): string;
	pickAt: number;
	reportAt: number;
	windowMs: number;
	compose(kind: DigestKind, night: string): Promise<Composed>;
	/** The marker's sentAt (unix s) or null when not sent; throws when the service does not answer. */
	getNotice(key: string): Promise<number | null>;
	putNotice(key: string, sentAtS: number): Promise<void>;
	canSend(): boolean;
	send(message: { title: string; body: string; url: string }): Promise<void>;
	log(message: string): void;
}

export interface Slot {
	kind: DigestKind;
	night: string;
	key: string;
	/** Consider composing from `from` to `until` (unix ms). */
	from: number;
	until: number;
}

const NOON = 12 * 60;

/** An exception's message for the log. */
export const reason = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Tonight's pick and last night's report as of `now`. */
export function slots(deps: Pick<SchedulerDeps, 'localDate' | 'localTime' | 'previousDate' | 'pickAt' | 'reportAt' | 'windowMs'>, now: number): Slot[] {
	const today = deps.localDate(now);
	const pickAt = deps.localTime(today, deps.pickAt);
	const last = deps.previousDate(today);
	return [
		{ kind: 'pick', night: today, key: `pick:${today}`, from: pickAt, until: pickAt + deps.windowMs },
		// The night's last frame may move the report past DIGEST_REPORT_AT; imaging ends by noon at the latest.
		{ kind: 'report', night: last, key: `report:${last}`, from: deps.localTime(today, deps.reportAt), until: deps.localTime(today, Math.max(NOON, deps.reportAt)) + deps.windowMs }
	];
}

export class Scheduler {
	/** Keys decided in this process: sent, already sent, not worth sending, or missed. */
	private done = new Set<string>();
	/** Sent but the marker is not stored yet: sentAt (unix s). */
	private unmarked = new Map<string, number>();
	/** Keys that failed at least once (to log when their window closes unsent). */
	private failing = new Set<string>();
	private running = false;

	private deps: SchedulerDeps;

	constructor(deps: SchedulerDeps) {
		this.deps = deps;
	}

	async tick(): Promise<void> {
		if (this.running) return;
		this.running = true;
		try {
			const now = this.deps.now();
			for (const slot of slots(this.deps, now)) {
				if (this.done.has(slot.key)) continue;
				if (now < slot.from) continue;
				if (now >= slot.until) {
					if (this.failing.delete(slot.key)) this.deps.log(`${slot.key}: window closed, not sent`);
					continue;
				}
				await this.run(slot, now);
			}
		} finally {
			this.running = false;
		}
	}

	private finish(key: string, message: string) {
		this.done.add(key);
		this.failing.delete(key);
		this.deps.log(`${key}: ${message}`);
	}

	private async run(slot: Slot, now: number): Promise<void> {
		const { deps } = this;
		const pending = this.unmarked.get(slot.key);
		if (pending !== undefined) {
			try {
				await deps.putNotice(slot.key, pending);
				this.unmarked.delete(slot.key);
				this.finish(slot.key, 'sent marker stored');
			} catch (e) {
				deps.log(`${slot.key}: storing the sent marker failed again: ${reason(e)}`);
			}
			return;
		}
		let digest: Composed;
		try {
			digest = await deps.compose(slot.kind, slot.night);
		} catch (e) {
			this.failing.add(slot.key);
			deps.log(`${slot.key}: composing failed, trying again at the next tick: ${reason(e)}`);
			return;
		}
		if (!digest.send) return this.finish(slot.key, `not sent: ${digest.reason ?? 'nothing to say'}`);
		if (digest.dueAt === null) return; // imaging still running
		const due = digest.dueAt * 1000;
		if (now < due) return;
		if (now >= due + deps.windowMs) return this.finish(slot.key, `missed: due ${new Date(due).toISOString()}, window closed`);
		if (!deps.canSend()) return this.finish(slot.key, `not sent (no token): ${digest.title} | ${digest.body.replaceAll('\n', ' | ')}`);
		let sentAt: number | null;
		try {
			sentAt = await deps.getNotice(slot.key);
		} catch (e) {
			this.failing.add(slot.key);
			deps.log(`${slot.key}: sent markers unavailable, not sending now: ${reason(e)}`);
			return;
		}
		if (sentAt !== null) return this.finish(slot.key, `already sent at ${new Date(sentAt * 1000).toISOString()}`);
		try {
			await deps.send({ title: digest.title, body: digest.body, url: digest.url });
		} catch (e) {
			this.failing.add(slot.key);
			deps.log(`${slot.key}: sending failed, trying again at the next tick: ${reason(e)}`);
			return;
		}
		const at = Math.round(deps.now() / 1000);
		try {
			await deps.putNotice(slot.key, at);
			this.finish(slot.key, `sent: ${digest.title}`);
		} catch (e) {
			this.unmarked.set(slot.key, at);
			deps.log(`${slot.key}: sent (${digest.title}), storing the sent marker failed: ${reason(e)}`);
		}
	}
}
