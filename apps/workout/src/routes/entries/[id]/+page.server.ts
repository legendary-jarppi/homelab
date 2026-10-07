import { error, fail, redirect } from '@sveltejs/kit';
import { today } from '$lib/domain';
import { config } from '$lib/server/config';
import { db } from '$lib/server/db';
import { parseWorkoutForm } from '$lib/server/form';
import { deleteWorkout, getWorkout, updateWorkout } from '$lib/server/workouts';
import type { Actions, PageServerLoad } from './$types';

function workoutId(param: string): number {
	if (!/^\d{1,15}$/.test(param)) error(404, 'Not found');
	return Number(param);
}

export const load: PageServerLoad = async ({ params }) => {
	const workout = await getWorkout(db(), workoutId(params.id));
	if (!workout) error(404, 'Not found');
	return { workout };
};

export const actions: Actions = {
	save: async ({ params, request }) => {
		const parsed = parseWorkoutForm(await request.formData(), today(config.timeZone));
		if ('error' in parsed) return fail(400, { error: parsed.error });
		if (!(await updateWorkout(db(), workoutId(params.id), parsed.input))) error(404, 'Not found');
		redirect(303, '/');
	},
	delete: async ({ params }) => {
		await deleteWorkout(db(), workoutId(params.id));
		redirect(303, '/');
	}
};
