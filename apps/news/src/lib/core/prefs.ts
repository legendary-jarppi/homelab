// Reader settings (users.settings JSON) and threshold storage.
import { z } from 'zod';
import type { Sql } from './db.ts';
import { INTENSITIES, PRESETS, presetThresholds, type Threshold } from './taxonomy.ts';

export const Settings = z.object({
	/**
	 * show: photos the classifier assessed and found fine for this reader are shown; others
	 * (unassessed, or tagged above the reader's thresholds) wait behind "Show photo".
	 * click: every photo waits behind "Show photo". hide: no photos at all.
	 */
	images: z.enum(['show', 'click', 'hide']).default('show'),
	/** Show the classifier's calm rewrite instead of the outlet's headline (original on the article page). */
	calmHeadlines: z.boolean().default(true),
	theme: z.enum(['system', 'light', 'dark']).default('system'),
	/** Last preset applied (informational; thresholds are stored per tag). */
	preset: z.string().nullable().default(null),
	onboarded: z.boolean().default(false)
});
export type Settings = z.infer<typeof Settings>;

export function parseSettings(raw: unknown): Settings {
	const result = Settings.safeParse(raw ?? {});
	return result.success ? result.data : Settings.parse({});
}

export async function saveSettings(sql: Sql, userId: number, settings: Settings): Promise<void> {
	await sql`UPDATE users SET settings = ${sql.json(settings)} WHERE id = ${userId}`;
}

/** Stored thresholds as smallints (1..3); 'off' = no row. */
export async function setThresholds(sql: Sql, userId: number, thresholds: Record<string, Threshold>): Promise<void> {
	const rows = Object.entries(thresholds)
		.filter(([, t]) => t !== 'off')
		.map(([tag, t]) => ({ user_id: userId, tag, threshold: INTENSITIES.indexOf(t as (typeof INTENSITIES)[number]) + 1 }));
	await sql.begin(async (tx) => {
		await tx`DELETE FROM user_thresholds WHERE user_id = ${userId}`;
		if (rows.length > 0) await tx`INSERT INTO user_thresholds ${tx(rows, 'user_id', 'tag', 'threshold')}`;
	});
}

export async function getThresholds(sql: Sql, userId: number): Promise<Record<string, Threshold>> {
	const rows = await sql<{ tag: string; threshold: number }[]>`SELECT tag, threshold FROM user_thresholds WHERE user_id = ${userId}`;
	return Object.fromEntries(rows.map((r) => [r.tag, INTENSITIES[r.threshold - 1]]));
}

export async function applyPreset(sql: Sql, userId: number, presetKey: string): Promise<void> {
	const preset = PRESETS.find((p) => p.key === presetKey);
	if (!preset) throw new Error(`unknown preset ${presetKey}`);
	await setThresholds(sql, userId, presetThresholds(preset));
}
