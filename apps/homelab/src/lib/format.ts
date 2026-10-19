// Formatting shared with apps/dashboard (same wording on both sites).

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
