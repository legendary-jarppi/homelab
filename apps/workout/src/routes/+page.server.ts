import { fail } from '@sveltejs/kit';
import { today } from '$lib/domain';
import { config } from '$lib/server/config';
import { db } from '$lib/server/db';
import { parseWorkoutForm, rememberPerson, rememberedPerson } from '$lib/server/form';
import { addWorkout, lastMachines, overview, recentWorkouts } from '$lib/server/workouts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ cookies }) => {
	const sql = db();
	const [machines, summary, recent] = await Promise.all([
		lastMachines(sql),
		overview(sql, today(config.timeZone)),
		recentWorkouts(sql, 15)
	]);
	return { person: rememberedPerson(cookies), lastMachines: machines, overview: summary, recent };
};

export const actions: Actions = {
	add: async ({ request, cookies }) => {
		const parsed = parseWorkoutForm(await request.formData(), today(config.timeZone));
		if ('error' in parsed) return fail(400, { error: parsed.error });
		await addWorkout(db(), parsed.input);
		rememberPerson(cookies, parsed.input.person);
		return { logged: parsed.input };
	}
};
