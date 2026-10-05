import { error } from '@sveltejs/kit';
import { removePackage } from '$lib/server/packages';
import type { RequestHandler } from './$types';

export const DELETE: RequestHandler = async ({ params }) => {
	if (!(await removePackage(params.id))) error(404, 'No such package');
	return new Response(null, { status: 204 });
};
