// Reader preference storage used by /welcome and /settings.
import { error, fail, type RequestEvent } from '@sveltejs/kit';
import { hashPassword, verifyPassword } from '$lib/core/auth';
import { db, type Sql } from '$lib/core/db';
import { getThresholds, parseSettings, saveSettings, setThresholds, type Settings } from '$lib/core/prefs';
import { INTENSITIES, PRESETS, presetThresholds, SENSITIVITY_TAGS, TAG_KEYS, THRESHOLDS, TOPICS, type Threshold } from '$lib/core/taxonomy';

export const MAX_BLOCKED_TERMS = 200;
export const MAX_TERM_LENGTH = 60;
export const MIN_PASSWORD_LENGTH = 10;

export function parseThreshold(value: FormDataEntryValue | null): Threshold | null {
	return THRESHOLDS.find((t) => t.value === value)?.value ?? null;
}

/** The signed-in user's id; hooks already redirect anonymous requests. */
export function userIdOf(locals: App.Locals): number {
	if (!locals.user) error(401, 'Sign in first');
	return locals.user.id;
}

/** Sensitivity form actions shared by /welcome and /settings. */
export const sensitivityActions = {
	family: async ({ request, locals }: RequestEvent) => {
		const form = await request.formData();
		const family = String(form.get('family') ?? '');
		const threshold = parseThreshold(form.get('threshold'));
		if (!threshold) return fail(400, { saved: null, message: 'Choose one of the options.' });
		await setFamilyThreshold(db(), userIdOf(locals), family, threshold);
		return { saved: `family:${family}`, message: null };
	},
	tags: async ({ request, locals }: RequestEvent) => {
		const form = await request.formData();
		const family = String(form.get('family') ?? '');
		const keys = SENSITIVITY_TAGS.filter((t) => t.family === family).map((t) => t.key);
		await setTagThresholds(db(), userIdOf(locals), formThresholds(form, keys));
		return { saved: `family:${family}`, message: null };
	}
};

/** Every tag present ('off' for tags without a stored row). */
export async function loadThresholds(sql: Sql, userId: number): Promise<Record<string, Threshold>> {
	const stored = await getThresholds(sql, userId);
	return Object.fromEntries(TAG_KEYS.map((k) => [k, stored[k] ?? 'off']));
}

/** Upserts or removes thresholds for the given tags only; other tags keep their values. */
export async function setTagThresholds(sql: Sql, userId: number, changes: Record<string, Threshold>): Promise<void> {
	const entries = Object.entries(changes).filter(([tag]) => TAG_KEYS.includes(tag));
	await sql.begin(async (tx) => {
		for (const [tag, threshold] of entries) {
			if (threshold === 'off') {
				await tx`DELETE FROM user_thresholds WHERE user_id = ${userId} AND tag = ${tag}`;
			} else {
				const value = INTENSITIES.indexOf(threshold) + 1;
				await tx`
					INSERT INTO user_thresholds (user_id, tag, threshold) VALUES (${userId}, ${tag}, ${value})
					ON CONFLICT (user_id, tag) DO UPDATE SET threshold = EXCLUDED.threshold`;
			}
		}
	});
}

/** A family threshold is applied to its tags at the moment of setting; later per-tag changes win. */
export async function setFamilyThreshold(sql: Sql, userId: number, family: string, threshold: Threshold): Promise<void> {
	const tags = SENSITIVITY_TAGS.filter((t) => t.family === family);
	if (tags.length === 0) error(400, 'Unknown family');
	await setTagThresholds(sql, userId, Object.fromEntries(tags.map((t) => [t.key, threshold])));
}

/** Replaces every per-tag threshold with the preset's and records the preset in settings. */
export async function applyPresetFor(sql: Sql, userId: number, presetKey: string): Promise<void> {
	const preset = PRESETS.find((p) => p.key === presetKey);
	if (!preset) error(400, 'Unknown comfort level');
	await setThresholds(sql, userId, presetThresholds(preset));
	await updateSettings(sql, userId, { preset: preset.key });
}

/** Re-reads the stored settings so concurrent changes from another tab are not overwritten with stale values. */
export async function updateSettings(sql: Sql, userId: number, patch: Partial<Settings>): Promise<Settings> {
	const [row] = await sql<{ settings: unknown }[]>`SELECT settings FROM users WHERE id = ${userId}`;
	const next = { ...parseSettings(row?.settings), ...patch };
	await saveSettings(sql, userId, next);
	return next;
}

/** Per-tag radio values from a form whose inputs are named `tag:<key>`. */
export function formThresholds(form: FormData, keys: string[]): Record<string, Threshold> {
	const out: Record<string, Threshold> = {};
	for (const key of keys) {
		const value = parseThreshold(form.get(`tag:${key}`));
		if (value) out[key] = value;
	}
	return out;
}

// ---------------------------------------------------------------------------------------------
// Topics, outlets, blocked words

export async function hiddenTopics(sql: Sql, userId: number): Promise<string[]> {
	const rows = await sql<{ topic: string }[]>`SELECT topic FROM user_hidden_topics WHERE user_id = ${userId}`;
	return rows.map((r) => r.topic);
}

export async function setHiddenTopics(sql: Sql, userId: number, topics: string[]): Promise<void> {
	const valid = [...new Set(topics)].filter((t) => TOPICS.some((x) => x.key === t));
	await sql.begin(async (tx) => {
		await tx`DELETE FROM user_hidden_topics WHERE user_id = ${userId}`;
		if (valid.length > 0) await tx`INSERT INTO user_hidden_topics ${tx(valid.map((topic) => ({ user_id: userId, topic })), 'user_id', 'topic')}`;
	});
}

export interface OutletChoice {
	id: number;
	name: string;
	language: string;
	hidden: boolean;
}

/** Enabled outlets with the reader's hidden flag. */
export async function outletChoices(sql: Sql, userId: number): Promise<OutletChoice[]> {
	return sql<OutletChoice[]>`
		SELECT o.id, o.name, o.language, (h.outlet_id IS NOT NULL) AS hidden
		FROM outlets o
		LEFT JOIN user_hidden_outlets h ON h.outlet_id = o.id AND h.user_id = ${userId}
		WHERE o.enabled
		ORDER BY o.name`;
}

/** Replaces the reader's hidden outlets among the enabled ones. */
export async function setHiddenOutlets(sql: Sql, userId: number, hiddenIds: number[]): Promise<void> {
	await sql.begin(async (tx) => {
		await tx`DELETE FROM user_hidden_outlets WHERE user_id = ${userId} AND outlet_id IN (SELECT id FROM outlets WHERE enabled)`;
		if (hiddenIds.length > 0) {
			await tx`
				INSERT INTO user_hidden_outlets (user_id, outlet_id)
				SELECT ${userId}, id FROM outlets WHERE enabled AND id = ANY(${hiddenIds}::int[])
				ON CONFLICT DO NOTHING`;
		}
	});
}

export interface BlockedTerm {
	term: string;
	whole_word: boolean;
}

export async function blockedTerms(sql: Sql, userId: number): Promise<BlockedTerm[]> {
	return sql<BlockedTerm[]>`SELECT term, whole_word FROM user_blocked_terms WHERE user_id = ${userId} ORDER BY created_at, term`;
}

export class SettingsError extends Error {}

/** Normalises what the reader typed; returns null when nothing matchable remains. */
export function normaliseTerm(raw: string): string | null {
	const term = raw.normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase();
	if (!/[\p{L}\p{N}]/u.test(term)) return null;
	return term.slice(0, MAX_TERM_LENGTH);
}

export async function addBlockedTerm(sql: Sql, userId: number, raw: string, wholeWord: boolean): Promise<void> {
	const term = normaliseTerm(raw);
	if (!term) throw new SettingsError('Type a word or a few words to block.');
	const [{ n }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM user_blocked_terms WHERE user_id = ${userId}`;
	if (n >= MAX_BLOCKED_TERMS) throw new SettingsError(`You can block up to ${MAX_BLOCKED_TERMS} words.`);
	await sql`
		INSERT INTO user_blocked_terms (user_id, term, whole_word) VALUES (${userId}, ${term}, ${wholeWord})
		ON CONFLICT (user_id, term) DO UPDATE SET whole_word = EXCLUDED.whole_word`;
}

export async function setTermWholeWord(sql: Sql, userId: number, term: string, wholeWord: boolean): Promise<void> {
	await sql`UPDATE user_blocked_terms SET whole_word = ${wholeWord} WHERE user_id = ${userId} AND term = ${term}`;
}

export async function removeBlockedTerm(sql: Sql, userId: number, term: string): Promise<void> {
	await sql`DELETE FROM user_blocked_terms WHERE user_id = ${userId} AND term = ${term}`;
}

// ---------------------------------------------------------------------------------------------
// Account

export async function setDisplayName(sql: Sql, userId: number, raw: string): Promise<void> {
	const name = raw.normalize('NFC').replace(/\s+/g, ' ').trim();
	if (name.length < 1 || name.length > 60) throw new SettingsError('Use 1 to 60 characters for your name.');
	await sql`UPDATE users SET display_name = ${name} WHERE id = ${userId}`;
}

/** Changes the password and ends every session of this user (the caller opens a fresh one). */
export async function changePassword(sql: Sql, userId: number, current: string, next: string): Promise<void> {
	const [row] = await sql<{ password_hash: string }[]>`SELECT password_hash FROM users WHERE id = ${userId}`;
	if (!row || !(await verifyPassword(current, row.password_hash))) throw new SettingsError('The current password is not right.');
	if (next.length < MIN_PASSWORD_LENGTH) throw new SettingsError(`Use at least ${MIN_PASSWORD_LENGTH} characters for the new password.`);
	const hash = await hashPassword(next);
	await sql.begin(async (tx) => {
		await tx`UPDATE users SET password_hash = ${hash} WHERE id = ${userId}`;
		await tx`DELETE FROM sessions WHERE user_id = ${userId}`;
	});
}
