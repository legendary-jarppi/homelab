import { formatAgo } from './format';
import type { SlowData } from './types';

/** Backups run nightly at 03:30 (platform/components/backup); an older success means a night was missed. */
const MAX_AGE_S = 26 * 3600;

/**
 * What is wrong with the backups, or null when the last night's run succeeded. `short` fits the top
 * bar's status pill; `detail` is for the Homelab card.
 */
export function backupProblem(backup: SlowData['homelab']['backup'], nowMs: number): { short: string; detail: string } | null {
	const { lastSuccess, lastFailure } = backup;
	if (lastFailure !== null && (lastSuccess === null || lastFailure > lastSuccess)) return { short: 'Backup failed', detail: 'Backup failed' };
	if (lastSuccess === null) return backup.running ? null : { short: 'No backup', detail: 'No backup yet' };
	if (nowMs / 1000 - lastSuccess > MAX_AGE_S && !backup.running) return { short: 'Backup late', detail: `Last backup ${formatAgo(lastSuccess, nowMs)}` };
	return null;
}
