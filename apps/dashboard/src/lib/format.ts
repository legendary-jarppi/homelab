/** Network rate in bits/s -> { value, unit } with 3 significant digits. */
export function formatBits(bps: number | null | undefined): { value: string; unit: string } {
	if (bps === null || bps === undefined || !Number.isFinite(bps)) return { value: '–', unit: '' };
	const units = ['b/s', 'kb/s', 'Mb/s', 'Gb/s'];
	let v = Math.max(0, bps);
	let i = 0;
	while (v >= 1000 && i < units.length - 1) {
		v /= 1000;
		i++;
	}
	return { value: v >= 100 || i === 0 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2), unit: units[i] };
}

/** Byte count -> "12.3 GB" (decimal units, like UniFi). */
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

/** Seconds -> "12 d 4 h", "3 h 12 min", "45 min". */
export function formatDuration(seconds: number | null | undefined): string {
	if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return '–';
	const d = Math.floor(seconds / 86400);
	const h = Math.floor((seconds % 86400) / 3600);
	const m = Math.floor((seconds % 3600) / 60);
	if (d > 0) return `${d} d ${h} h`;
	if (h > 0) return `${h} h ${m} min`;
	return `${m} min`;
}

/** Unix seconds -> "just now", "5 min ago", "3 h ago", "2 d ago". */
export function formatAgo(unixS: number, now = Date.now()): string {
	const s = Math.max(0, now / 1000 - unixS);
	if (s < 90) return 'just now';
	if (s < 3600) return `${Math.round(s / 60)} min ago`;
	if (s < 86400) return `${Math.round(s / 3600)} h ago`;
	return `${Math.round(s / 86400)} d ago`;
}

/** Smallest "nice" axis maximum (1, 2, 2.5, 5 × 10^k) at or above value. */
export function niceMax(value: number): number {
	if (!(value > 0)) return 1;
	const magnitude = 10 ** Math.floor(Math.log10(value));
	const step = [1, 2, 2.5, 5, 10].find((f) => f * magnitude >= value) ?? 10;
	return step * magnitude;
}
