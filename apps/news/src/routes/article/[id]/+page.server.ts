import { redirect } from '@sveltejs/kit';
import { article, markRead, mute, parseId, readerContext, report, save, unmute } from '$lib/server/articles';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params }) => {
	const ctx = await readerContext(locals);
	const view = await article(ctx, parseId(params.id));
	await markRead(ctx, view.id);
	return { article: view };
};

// Every action checks visibility first: a hidden article answers with the same 404 as a missing one.
export const actions: Actions = {
	save: async ({ locals, params, request }) => {
		const on = (await request.formData()).get('on') === '1';
		await save(await readerContext(locals), parseId(params.id), on);
		return { saved: on };
	},
	mute: async ({ locals, params }) => {
		await mute(await readerContext(locals), parseId(params.id));
		redirect(303, '/');
	},
	report: async ({ locals, params }) => {
		await report(await readerContext(locals), parseId(params.id));
		redirect(303, '/');
	},
	unmute: async ({ locals, params }) => {
		const id = parseId(params.id);
		await unmute(await readerContext(locals), id);
		redirect(303, `/article/${id}`);
	}
};
