import { fail, type ActionFailure } from '@sveltejs/kit';
import { createInvite } from '$lib/core/auth';
import { db } from '$lib/core/db';
import { AdminError, adminIdOf, deleteUser, openInvites, resetPassword, revokeInvite, setRole, users } from '$lib/server/admin';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const [userRows, invites] = await Promise.all([users(db()), openInvites(db())]);
	return { users: userRows, invites, me: adminIdOf(locals) };
};

const parseRole = (value: FormDataEntryValue | null) => (value === 'admin' || value === 'reader' ? value : null);

/** Turns expected refusals into a form message; anything else is a real error. */
async function guarded<T>(run: () => Promise<T>): Promise<T | ActionFailure<{ message: string }>> {
	try {
		return await run();
	} catch (e) {
		if (e instanceof AdminError) return fail(400, { message: e.message });
		throw e;
	}
}

export const actions = {
	reset: async ({ request, locals }) => {
		adminIdOf(locals);
		const form = await request.formData();
		const id = Number(form.get('id'));
		return guarded(async () => ({ temporary: await resetPassword(db(), id), forUser: String(form.get('username') ?? ''), message: null }));
	},
	role: async ({ request, locals }) => {
		adminIdOf(locals);
		const form = await request.formData();
		const role = parseRole(form.get('role'));
		if (!role) return fail(400, { message: 'Unknown role.' });
		return guarded(async () => {
			await setRole(db(), Number(form.get('id')), role);
			return { message: 'Role changed.' };
		});
	},
	delete: async ({ request, locals }) => {
		const adminId = adminIdOf(locals);
		const form = await request.formData();
		if (form.get('confirm') !== 'yes') return fail(400, { message: 'Tick the box to confirm.' });
		return guarded(async () => {
			await deleteUser(db(), Number(form.get('id')), adminId);
			return { message: 'User deleted.' };
		});
	},
	invite: async ({ request, locals, url }) => {
		const adminId = adminIdOf(locals);
		const form = await request.formData();
		const role = parseRole(form.get('role'));
		if (!role) return fail(400, { message: 'Unknown role.' });
		const note = String(form.get('note') ?? '').trim().slice(0, 200) || undefined;
		const code = await createInvite(db(), { createdBy: adminId, role, note });
		return { inviteUrl: `${url.origin}/join/${code}`, message: null };
	},
	revoke: async ({ request, locals }) => {
		adminIdOf(locals);
		await revokeInvite(db(), String((await request.formData()).get('code') ?? ''));
		return { message: 'Invite revoked.' };
	}
} satisfies Actions;
