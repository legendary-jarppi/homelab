import { fail } from '@sveltejs/kit';
import { db } from '$lib/core/db';
import { adminIdOf, discoverNow, outletRows, RECLASSIFY_DAYS, reclassifyOutlet, reextractFailed, REFETCH_PAYWALLED_DAYS, refetchPaywalled, setOutletEnabled, setOutletPriority } from '$lib/server/admin';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async () => ({ outlets: await outletRows(db()), reclassifyDays: RECLASSIFY_DAYS, refetchDays: REFETCH_PAYWALLED_DAYS });

async function outletIdFrom(request: Request): Promise<{ id: number; form: FormData }> {
	const form = await request.formData();
	return { id: Number(form.get('id')), form };
}

export const actions = {
	enabled: async ({ request, locals }) => {
		adminIdOf(locals);
		const { id, form } = await outletIdFrom(request);
		await setOutletEnabled(db(), id, form.get('enabled') === 'true');
		return { outletId: id, message: form.get('enabled') === 'true' ? 'Enabled.' : 'Disabled: discovery stops; stored articles stay.' };
	},
	priority: async ({ request, locals }) => {
		adminIdOf(locals);
		const { id, form } = await outletIdFrom(request);
		const priority = Number(form.get('priority'));
		if (!Number.isInteger(priority) || priority < 0 || priority > 1000) return fail(400, { outletId: id, message: 'Priority is a whole number from 0 to 1000.' });
		await setOutletPriority(db(), id, priority);
		return { outletId: id, message: `Priority set to ${priority}.` };
	},
	discover: async ({ request, locals }) => {
		adminIdOf(locals);
		const { id } = await outletIdFrom(request);
		await discoverNow(db(), id);
		return { outletId: id, message: 'Discovery requested; the worker runs it on its next pass.' };
	},
	reextract: async ({ request, locals }) => {
		adminIdOf(locals);
		const { id } = await outletIdFrom(request);
		const n = await reextractFailed(db(), id);
		return { outletId: id, message: `${n} failed article(s) queued for extraction.` };
	},
	refetchPaywalled: async ({ request, locals }) => {
		adminIdOf(locals);
		const { id } = await outletIdFrom(request);
		const n = await refetchPaywalled(db(), id);
		return { outletId: id, message: `${n} paywalled article(s) queued for fetching again.` };
	},
	reclassify: async ({ request, locals }) => {
		adminIdOf(locals);
		const { id } = await outletIdFrom(request);
		const n = await reclassifyOutlet(db(), id);
		return { outletId: id, message: `${n} article(s) queued for classification; hidden from readers until done.` };
	}
} satisfies Actions;
