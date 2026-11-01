import { error, json } from '@sveltejs/kit';
import { addPackage, listPackages, PackageInputError } from '$lib/server/packages';
import type { Carrier } from '$lib/types';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => json(await listPackages(), { headers: { 'Cache-Control': 'no-store' } });

/** Body: { code?, label?, carrier? } (carrier detected from the code when omitted). Without a code (still to come) the label is required. */
export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json().catch(() => null)) as { code?: string | null; label?: string; carrier?: Carrier } | null;
	if (!body) error(400, 'Package missing');
	try {
		return json(await addPackage({ code: body.code, label: body.label, carrier: body.carrier ?? null }), { status: 201 });
	} catch (e) {
		if (e instanceof PackageInputError) error(400, e.message);
		throw e;
	}
};
