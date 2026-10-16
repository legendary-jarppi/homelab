import { error, json } from '@sveltejs/kit';
import { PackageInputError, removePackage, updatePackage } from '$lib/server/packages';
import type { RequestHandler } from './$types';

/** Body: { label?: string | null, archived?: boolean }: rename; to the archive, or back to the card. */
export const PATCH: RequestHandler = async ({ params, request }) => {
	const body = (await request.json().catch(() => null)) as { label?: unknown; archived?: unknown } | null;
	const label = body?.label;
	const archived = body?.archived;
	if (label !== undefined && label !== null && typeof label !== 'string') error(400, 'label must be text or null');
	if (archived !== undefined && typeof archived !== 'boolean') error(400, 'archived must be true or false');
	if (label === undefined && archived === undefined) error(400, 'Nothing to change');
	try {
		const p = await updatePackage(params.id, { label, archived });
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
