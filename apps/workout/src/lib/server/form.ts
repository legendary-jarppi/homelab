import { isIsoDate, isMachine, isPerson, parseKm, type PersonId } from '$lib/domain';
import type { Cookies } from '@sveltejs/kit';
import type { WorkoutInput } from './workouts';

/** Who the device logged for last; preselected next time. */
export const PERSON_COOKIE = 'workout_person';

export function rememberedPerson(cookies: Cookies): PersonId {
	const value = cookies.get(PERSON_COOKIE);
	return isPerson(value) ? value : 'jari';
}

export function rememberPerson(cookies: Cookies, person: PersonId) {
	cookies.set(PERSON_COOKIE, person, { path: '/', httpOnly: false, sameSite: 'lax', maxAge: 365 * 24 * 60 * 60 });
}

/** Validates the entry form (person, machine, day, km). Days after `today` are rejected. */
export function parseWorkoutForm(data: FormData, today: string): { input: WorkoutInput } | { error: string } {
	const person = data.get('person');
	const machine = data.get('machine');
	const day = data.get('day');
	const meters = parseKm(String(data.get('km') ?? ''));
	if (!isPerson(person)) return { error: 'Choose who worked out.' };
	if (!isMachine(machine)) return { error: 'Choose a machine.' };
	if (!isIsoDate(day) || day > today) return { error: 'Choose a date that is not in the future.' };
	if (meters === null) return { error: 'Distance must be a number of kilometres, like 10 or 7.5.' };
	return { input: { person, machine, day, meters } };
}
