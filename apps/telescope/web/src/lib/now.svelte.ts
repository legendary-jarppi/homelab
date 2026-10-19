// A clock for the pages: exposure progress, "x min ago", ETA. Ticks while some page uses it.
class Now {
	ms = $state(Date.now());
	#users = 0;
	#timer: ReturnType<typeof setInterval> | undefined;

	/** Call from an $effect in the browser; returns the cleanup. */
	use() {
		if (this.#users++ === 0) this.#timer = setInterval(() => (this.ms = Date.now()), 1000);
		return () => {
			if (--this.#users === 0) clearInterval(this.#timer);
		};
	}
}

export const now = new Now();
