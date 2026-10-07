import { formatAgo } from './format';
import type { SlowData } from './types';

/** Backups run nightly at 03:30 (platform/components/backup); an older success means a night was missed. */
const MAX_AGE_S = 26 * 3600;

/** What is wrong with the backups, or null when the last night's run succeeded. */
export function backupProblem(backup: SlowData['homelab']['backup'], nowMs: number): string | null {
	const { lastSuccess, lastFailure } = backup;
	if (lastFailure !== null && (lastSuccess === null || lastFailure > lastSuccess)) return 'Backup failed';
	if (lastSuccess === null) return backup.running ? null : 'No backup yet';
	if (nowMs / 1000 - lastSuccess > MAX_AGE_S && !backup.running) return `Last backup ${formatAgo(lastSuccess, nowMs)}`;
	return null;
}
