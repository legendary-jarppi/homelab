import { fail } from '@sveltejs/kit';
import { config } from '$lib/server/config';
import { db } from '$lib/server/db';
import { devices, history, removeDevice, rename, send, SendError, setTopic, topicChoices } from '$lib/server/notify';
import { topic } from '$lib/server/topics';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const sql = db();
	const [mine, choices, recent] = await Promise.all([devices(sql, locals.user.id), topicChoices(sql, locals.user.id), history(sql, locals.user.id)]);
	return {
		user: locals.user,
		vapidPublicKey: config.vapidPublicKey,
		// Endpoints identify "this device" in the browser; they are the person's own.
		devices: mine,
		topics: choices,
		history: recent.map((m) => ({ ...m, topicName: m.topic ? (topic(m.topic)?.name ?? m.topic) : null }))
	};
};

export const actions: Actions = {
	topic: async ({ request, locals }) => {
		const f = await request.formData();
		const id = String(f.get('topic') ?? '');
		if (!topic(id)) return fail(400, { error: 'Unknown topic' });
		await setTopic(db(), locals.user.id, id, f.get('enabled') === 'on');
	},
	name: async ({ request, locals }) => {
		const name = String((await request.formData()).get('name') ?? '').trim().slice(0, 40);
		if (!name) return fail(400, { error: 'Name is required' });
		await rename(db(), locals.user.id, name);
	},
	removeDevice: async ({ request, locals }) => {
		const id = Number((await request.formData()).get('id'));
		if (!Number.isInteger(id)) return fail(400, { error: 'Unknown device' });
		await removeDevice(db(), locals.user.id, { id });
	},
	test: async ({ locals }) => {
		try {
			const r = await send(db(), {
				sender: 'notify',
				userIds: [locals.user.id],
				title: 'Test notification',
				body: `Hello ${locals.user.name}, notifications work.`,
				url: null
			});
			return { test: r };
		} catch (e) {
			if (e instanceof SendError) return fail(503, { error: e.message });
			throw e;
		}
	}
};
