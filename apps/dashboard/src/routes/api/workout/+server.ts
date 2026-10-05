import { error, json } from '@sveltejs/kit';
import { config } from '$lib/server/config';
import type { WorkoutSummary } from '$lib/types';
import type { RequestHandler } from './$types';

/** This week's workouts from apps/workout; the token never reaches the browser. */
export const GET: RequestHandler = async () => {
	if (!config.workoutToken) error(404, 'Workout summary not configured');
	const response = await fetch(new URL('/api/summary', config.workoutUrl), {
		headers: { authorization: `Bearer ${config.workoutToken}` },
		signal: AbortSignal.timeout(5000)
	});
	if (!response.ok) error(502, `workout: ${response.status}`);
	const body: WorkoutSummary = await response.json();
	return json(body, { headers: { 'Cache-Control': 'no-store' } });
};
