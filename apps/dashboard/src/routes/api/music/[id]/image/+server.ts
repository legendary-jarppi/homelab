import { error } from '@sveltejs/kit';
import { MusicError, playerImage } from '$lib/server/bluos';
import type { RequestHandler } from './$types';

/** A picture stored on the player (?path=/images/…, /Artwork?…): the browser may be away from home. */
export const GET: RequestHandler = async ({ params, url }) => {
	try {
		return await playerImage(params.id, url.searchParams.get('path') ?? '');
	} catch (e) {
		if (e instanceof MusicError) error(e.status, e.message);
		throw e;
	}
};
