import { error, json } from '@sveltejs/kit';
import { CARRIERS } from '$lib/packages';
import { PackageInputError, removePackage, updatePackage } from '$lib/server/packages';
import type { Carrier, PackageReturn } from '$lib/types';
import type { RequestHandler } from './$types';

/**
 * Body: { label?: string | null, code?: string, carrier?: Carrier, returned?: 'full' | 'partial' | null, archived?: boolean }:
 * rename; add (or correct) the tracking code, carrier detected unless given; mark returned, or not;
 * to the archive, or back to the card.
 */
export const PATCH: RequestHandler = async ({ params, request }) => {
	const body = (await request.json().catch(() => null)) as { label?: unknown; code?: unknown; carrier?: unknown; returned?: unknown; archived?: unknown } | null;
	const { label, code, carrier, returned, archived } = body ?? {};
	if (label !== undefined && label !== null && typeof label !== 'string') error(400, 'label must be text or null');
	if (code !== undefined && typeof code !== 'string') error(400, 'code must be text');
	if (carrier !== undefined && carrier !== null && !CARRIERS.some((c) => c.id === carrier)) error(400, 'Unknown carrier');
	if (carrier != null && code === undefined) error(400, 'carrier goes with code');
	if (returned !== undefined && returned !== null && returned !== 'full' && returned !== 'partial') error(400, 'returned must be full, partial or null');
	if (archived !== undefined && typeof archived !== 'boolean') error(400, 'archived must be true or false');
	if (label === undefined && code === undefined && returned === undefined && archived === undefined) error(400, 'Nothing to change');
	try {
		const p = await updatePackage(params.id, { label, code, carrier: carrier as Carrier | null | undefined, returned: returned as PackageReturn | null | undefined, archived });
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
