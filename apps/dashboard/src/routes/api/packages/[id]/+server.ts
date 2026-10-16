import { error, json } from '@sveltejs/kit';
import { PackageInputError, removePackage, setArchived } from '$lib/server/packages';
import type { RequestHandler } from './$types';

/** Body: { archived: boolean }: to the archive, or back to the card. */
export const PATCH: RequestHandler = async ({ params, request }) => {
	const body = (await request.json().catch(() => null)) as { archived?: unknown } | null;
	if (typeof body?.archived !== 'boolean') error(400, 'archived (true or false) missing');
	try {
		const p = await setArchived(params.id, body.archived);
		if (!p) error(404, 'No such package');
		return json(p);
	} catch (e) {
		if (e instanceof PackageInputError) error(400, e.message);
		throw e;
	}
};

/** Deletes for good (from the card or the archive). */
export const DELETE: RequestHandler = async ({ params }) => {
	if (!(await removePackage(params.id))) error(404, 'No such package');
	return new Response(null, { status: 204 });
};
