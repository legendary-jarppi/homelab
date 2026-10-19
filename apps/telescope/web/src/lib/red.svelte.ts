// Red night mode (A10), per device (localStorage): off, on, or auto (on while the sun is below the
// horizon at the site). app.html applies the last shown state before the first paint.
import { sunAltitude } from './sky';

export type RedMode = 'off' | 'on' | 'auto';

const MODE_KEY = 'telescope.redMode';
const ACTIVE_KEY = 'telescope.redActive';

class Red {
	mode = $state<RedMode>('off');
	/** Sun below the horizon at the site (auto); recomputed every minute. */
	sunDown = $state(false);
	active = $derived(this.mode === 'on' || (this.mode === 'auto' && this.sunDown));

	/** Call once in the browser with the site; returns the cleanup. */
	start(site: { lat: number; lon: number } | null) {
		const saved = localStorage.getItem(MODE_KEY);
		if (saved === 'off' || saved === 'on' || saved === 'auto') this.mode = saved;
		const update = () => (this.sunDown = site ? sunAltitude(site.lat, site.lon, Date.now()) < 0 : false);
		update();
		const timer = setInterval(update, 60_000);
		return () => clearInterval(timer);
	}

	set(mode: RedMode) {
		this.mode = mode;
		localStorage.setItem(MODE_KEY, mode);
	}

	/** Apply to the document (class on <html>, theme colour) and remember for the next first paint. */
	apply(active: boolean) {
		document.documentElement.classList.toggle('red', active);
		document.querySelector('meta[name="theme-color"]')?.setAttribute('content', active ? '#000000' : '#070a12');
		localStorage.setItem(ACTIVE_KEY, active ? '1' : '0');
	}
}

export const red = new Red();
