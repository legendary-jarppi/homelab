import { error, fail } from '@sveltejs/kit';
import { INTENSITY_LABELS } from '$lib/components/account/format';
import { db } from '$lib/core/db';
import { adminIdOf, articleForAdmin, correctTag, purgeArticle, reclassifyArticle, resolveReport } from '$lib/server/admin';
import type { Actions, PageServerLoad } from './$types';

function articleId(param: string): number {
	const id = Number(param);
	if (!Number.isSafeInteger(id) || id <= 0) error(404, 'Not found');
	return id;
}

export const load: PageServerLoad = async ({ params, url }) => {
	const review = await articleForAdmin(db(), articleId(params.id));
	if (!review) error(404, 'Not found');
	const reportId = Number(url.searchParams.get('report')) || null;
	return { ...review, reportId: review.openReports.some((r) => r.id === reportId) ? reportId : null };
};

export const actions = {
	correct: async ({ request, params, locals }) => {
		const adminId = adminIdOf(locals);
		const form = await request.formData();
		const tag = String(form.get('tag') ?? '');
		const intensity = Number(form.get('intensity'));
		await correctTag(db(), { articleId: articleId(params.id), tag, intensity, adminId, reportId: Number(form.get('report')) || null });
		return { message: `Tag ${tag} set to ${INTENSITY_LABELS[intensity]}. Readers see the change on their next page.` };
	},
	reclassify: async ({ params, locals }) => {
		adminIdOf(locals);
		const queued = await reclassifyArticle(db(), articleId(params.id));
		if (!queued) return fail(400, { message: 'Only extracted, unpurged articles can be re-classified.' });
		return { message: 'Queued for classification. Hidden from readers until done; manual tags are kept.' };
	},
	purge: async ({ request, params, locals }) => {
		adminIdOf(locals);
		if ((await request.formData()).get('confirm') !== 'yes') return fail(400, { message: 'Tick the box to confirm the purge.' });
		await purgeArticle(db(), articleId(params.id));
		return { message: 'Stored text and photo files deleted. Classification kept.' };
	},
	resolve: async ({ request, locals }) => {
		const adminId = adminIdOf(locals);
		await resolveReport(db(), Number((await request.formData()).get('report')), adminId);
		return { message: 'Report resolved.' };
	}
} satisfies Actions;
