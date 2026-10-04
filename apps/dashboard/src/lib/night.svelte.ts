// Night mode for an always-on iPad: a dim, clock-only screen at night.
// Mode is per device (localStorage): auto (22:00–06:30), always on, or off.
export type NightMode = 'auto' | 'on' | 'off';

const STORAGE_KEY = 'dashboard.nightMode';
const NIGHT_START_MIN = 22 * 60;
const NIGHT_END_MIN = 6 * 60 + 30;
/** After a tap on the night screen, show the full dashboard this long. */
const PEEK_MS = 60_000;

class Night {
	mode = $state<NightMode>('auto');
	now = $state(new Date());
	peekUntil = $state(0);

	/** Night screen is showing. */
	active = $derived.by(() => {
		if (this.peekUntil > this.now.getTime()) return false;
		if (this.mode !== 'auto') return this.mode === 'on';
		const minutes = this.now.getHours() * 60 + this.now.getMinutes();
		return minutes >= NIGHT_START_MIN || minutes < NIGHT_END_MIN;
	});

	/** Call once in the browser; returns a cleanup function. */
	start() {
		const saved = localStorage.getItem(STORAGE_KEY);
		if (saved === 'auto' || saved === 'on' || saved === 'off') this.mode = saved;
		const timer = setInterval(() => (this.now = new Date()), 1000);
		return () => clearInterval(timer);
	}

	set(mode: NightMode) {
		this.mode = mode;
		this.peekUntil = 0;
		localStorage.setItem(STORAGE_KEY, mode);
	}

	peek() {
		this.peekUntil = Date.now() + PEEK_MS;
	}
}

export const night = new Night();
