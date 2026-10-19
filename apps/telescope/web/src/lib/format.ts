// Display helpers; times in the browser's zone (the app is used in Finland).

/** Seconds -> "3 h 12 min", "45 min", "12 d 4 h". */
export function formatDuration(seconds: number | null | undefined): string {
	if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return '–';
	const d = Math.floor(seconds / 86400);
	const h = Math.floor((seconds % 86400) / 3600);
	const m = Math.floor((seconds % 3600) / 60);
	if (d > 0) return `${d} d ${h} h`;
	if (h > 0) return `${h} h ${m} min`;
	return `${m} min`;
}

/** Byte count -> "12.3 GB" (decimal units). */
export function formatBytes(bytes: number | null | undefined): string {
	if (bytes === null || bytes === undefined || !Number.isFinite(bytes)) return '–';
	const units = ['B', 'kB', 'MB', 'GB', 'TB'];
	let v = Math.max(0, bytes);
	let i = 0;
	while (v >= 1000 && i < units.length - 1) {
		v /= 1000;
		i++;
	}
	return `${v >= 100 || i === 0 ? v.toFixed(0) : v.toFixed(1)} ${units[i]}`;
}

/** Unix ms -> "23:41". */
export const clock = (ms: number) => new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

/** Unix seconds -> "just now", "5 min ago", "3 h ago", "2 d ago". */
export function formatAgo(unixS: number, nowMs = Date.now()): string {
	const s = Math.max(0, nowMs / 1000 - unixS);
	if (s < 90) return 'just now';
	if (s < 3600) return `${Math.round(s / 60)} min ago`;
	if (s < 86400) return `${Math.round(s / 3600)} h ago`;
	return `${Math.round(s / 86400)} d ago`;
}

/** "2026-10-17" -> "Sat 17 Oct 2026" (the evening the night starts). */
export function nightLabel(night: string, withYear = true): string {
	const [y, m, d] = night.split('-').map(Number);
	return new Date(y, m - 1, d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', ...(withYear ? { year: 'numeric' } : {}) });
}

/** Arcsec: one decimal from 1″ up, two below. */
export const arcsec = (v: number | null | undefined) => (v === null || v === undefined ? '–' : v >= 1 ? v.toFixed(1) : v.toFixed(2));

/** A number with `digits` decimals, or "–". */
export const fixed = (v: number | null | undefined, digits = 0) => (v === null || v === undefined || !Number.isFinite(v) ? '–' : v.toFixed(digits));

/** Degrees -> "02h 27m 36s" (RA) or "+62° 00′" (Dec). */
export function formatRa(deg: number): string {
	const h = (((deg / 15) % 24) + 24) % 24;
	const s = Math.round(h * 3600);
	return `${String(Math.floor(s / 3600)).padStart(2, '0')}h ${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}m ${String(s % 60).padStart(2, '0')}s`;
}
export function formatDec(deg: number): string {
	const m = Math.round(Math.abs(deg) * 60);
	return `${deg < 0 ? '−' : '+'}${Math.floor(m / 60)}° ${String(m % 60).padStart(2, '0')}′`;
}

/** Main camera ~1.16″/px: under 1″ RMS is good, up to 2″ usable, beyond that stars elongate. */
export const guideGrade = (v: number | null | undefined) => (v === null || v === undefined ? '' : v < 1 ? 'good' : v <= 2 ? '' : 'poor');
