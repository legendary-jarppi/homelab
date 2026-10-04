import { fail, redirect } from '@sveltejs/kit';
import { createSession } from '$lib/core/auth';
import { db } from '$lib/core/db';
import { PRESETS, TOPICS } from '$lib/core/taxonomy';
import { SESSION_COOKIE, setSessionCookie } from '$lib/server/session';
import {
	addBlockedTerm,
	applyPresetFor,
	blockedTerms,
	changePassword,
	hiddenTopics,
	loadThresholds,
	MAX_TERM_LENGTH,
	MIN_PASSWORD_LENGTH,
	outletChoices,
	removeBlockedTerm,
	sensitivityActions,
	setDisplayName,
	setHiddenOutlets,
	setHiddenTopics,
	SettingsError,
	setTermWholeWord,
	updateSettings,
	userIdOf
} from '$lib/server/settings';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const userId = userIdOf(locals);
	const sql = db();
	const [thresholds, hidden, outlets, terms] = await Promise.all([
		loadThresholds(sql, userId),
		hiddenTopics(sql, userId),
		outletChoices(sql, userId),
		blockedTerms(sql, userId)
	]);
	return {
		settings: locals.settings,
		displayName: locals.user?.displayName ?? '',
		username: locals.user?.username ?? '',
		thresholds,
		hiddenTopics: hidden,
		outlets,
		terms,
		minPasswordLength: MIN_PASSWORD_LENGTH,
		maxTermLength: MAX_TERM_LENGTH
	};
};

const saved = (section: string) => ({ saved: section, message: null });
const failed = (section: string, message: string) => fail(400, { saved: null, section, message });

export const actions = {
	...sensitivityActions,

	/** Two steps: the first post asks for confirmation, because a preset replaces every per-subject choice. */
	preset: async ({ request, locals }) => {
		const form = await request.formData();
		const preset = String(form.get('preset') ?? '');
		if (!PRESETS.some((p) => p.key === preset)) return failed('comfort', 'Choose one of the comfort levels.');
		if (form.get('confirm') !== 'yes') return { confirmPreset: preset, saved: null, message: null };
		await applyPresetFor(db(), userIdOf(locals), preset);
		return saved('comfort');
	},

	topics: async ({ request, locals }) => {
		const form = await request.formData();
		const shown = new Set(form.getAll('topic').map(String));
		const [bulkFamily, bulkAction] = String(form.get('bulk') ?? '').split(':');
		for (const topic of TOPICS) {
			if (topic.family !== bulkFamily) continue;
			if (bulkAction === 'show') shown.add(topic.key);
			else if (bulkAction === 'hide') shown.delete(topic.key);
		}
		await setHiddenTopics(db(), userIdOf(locals), TOPICS.filter((t) => !shown.has(t.key)).map((t) => t.key));
		return saved('topics');
	},

	outlets: async ({ request, locals }) => {
		const form = await request.formData();
		const shown = new Set(form.getAll('outlet').map(Number));
		const userId = userIdOf(locals);
		const outlets = await outletChoices(db(), userId);
		await setHiddenOutlets(db(), userId, outlets.filter((o) => !shown.has(o.id)).map((o) => o.id));
		return saved('outlets');
	},

	addTerm: async ({ request, locals }) => {
		const form = await request.formData();
		try {
			await addBlockedTerm(db(), userIdOf(locals), String(form.get('term') ?? ''), form.get('whole_word') === 'on');
		} catch (e) {
			if (e instanceof SettingsError) return failed('words', e.message);
			throw e;
		}
		return saved('words');
	},

	termWhole: async ({ request, locals }) => {
		const form = await request.formData();
		await setTermWholeWord(db(), userIdOf(locals), String(form.get('term') ?? ''), form.get('whole_word') === 'on');
		return saved('words');
	},

	removeTerm: async ({ request, locals }) => {
		const form = await request.formData();
		await removeBlockedTerm(db(), userIdOf(locals), String(form.get('term') ?? ''));
		return saved('words');
	},

	display: async ({ request, locals }) => {
		const form = await request.formData();
		const images = form.get('images');
		if (images !== 'show' && images !== 'click' && images !== 'hide') return failed('display', 'Choose how photos are shown.');
		await updateSettings(db(), userIdOf(locals), { images, calmHeadlines: form.get('calmHeadlines') === 'on' });
		return saved('display');
	},

	theme: async ({ request, locals }) => {
		const theme = (await request.formData()).get('theme');
		if (theme !== 'system' && theme !== 'light' && theme !== 'dark') return failed('theme', 'Choose a theme.');
		await updateSettings(db(), userIdOf(locals), { theme });
		return saved('theme');
	},

	name: async ({ request, locals }) => {
		try {
			await setDisplayName(db(), userIdOf(locals), String((await request.formData()).get('displayName') ?? ''));
		} catch (e) {
			if (e instanceof SettingsError) return failed('account', e.message);
			throw e;
		}
		return saved('name');
	},

	password: async ({ request, locals, cookies, url }) => {
		const form = await request.formData();
		const next = String(form.get('next') ?? '');
		if (next !== String(form.get('confirm') ?? '')) return failed('password', 'The two new passwords do not match.');
		const userId = userIdOf(locals);
		try {
			await changePassword(db(), userId, String(form.get('current') ?? ''), next);
		} catch (e) {
			if (e instanceof SettingsError) return failed('password', e.message);
			throw e;
		}
		// Every session ended with the old password; this device continues with a fresh one.
		const session = await createSession(db(), userId, request.headers.get('user-agent'));
		setSessionCookie(cookies, url, session.token, session.maxAgeS);
		return saved('password');
	},

	signOutAll: async ({ locals, cookies }) => {
		await db()`DELETE FROM sessions WHERE user_id = ${userIdOf(locals)}`;
		cookies.delete(SESSION_COOKIE, { path: '/' });
		redirect(303, '/login');
	}
} satisfies Actions;
