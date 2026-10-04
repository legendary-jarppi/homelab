import { fail, redirect } from '@sveltejs/kit';
import { db } from '$lib/core/db';
import { PRESETS } from '$lib/core/taxonomy';
import { applyPresetFor, loadThresholds, sensitivityActions, updateSettings, userIdOf } from '$lib/server/settings';
import type { Actions, PageServerLoad } from './$types';

const STEPS = 5;
const DEFAULT_PRESET = 'gentle';

export const load: PageServerLoad = async ({ url, locals }) => {
	const step = Math.min(STEPS, Math.max(1, Number(url.searchParams.get('step')) || 1));
	return {
		step,
		steps: STEPS,
		preset: locals.settings.preset ?? DEFAULT_PRESET,
		thresholds: step === 3 ? await loadThresholds(db(), userIdOf(locals)) : {},
		images: locals.settings.images,
		calmHeadlines: locals.settings.calmHeadlines
	};
};

export const actions = {
	...sensitivityActions,

	preset: async ({ request, locals }) => {
		const preset = String((await request.formData()).get('preset') ?? '');
		if (!PRESETS.some((p) => p.key === preset)) return fail(400, { saved: null, message: 'Choose one of the comfort levels.' });
		await applyPresetFor(db(), userIdOf(locals), preset);
		redirect(303, '/welcome?step=3');
	},

	display: async ({ request, locals }) => {
		const form = await request.formData();
		const images = form.get('images');
		if (images !== 'show' && images !== 'click' && images !== 'hide') return fail(400, { saved: null, message: 'Choose how photos are shown.' });
		await updateSettings(db(), userIdOf(locals), { images, calmHeadlines: form.get('calmHeadlines') === 'on' });
		redirect(303, '/welcome?step=5');
	},

	finish: async ({ locals }) => {
		const userId = userIdOf(locals);
		// Reached step 5 without choosing a level (e.g. by URL): start from the default rather than unfiltered.
		if (!locals.settings.preset) await applyPresetFor(db(), userId, DEFAULT_PRESET);
		await updateSettings(db(), userId, { onboarded: true });
		redirect(303, '/');
	}
} satisfies Actions;
