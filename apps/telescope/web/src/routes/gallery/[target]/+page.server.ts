import { loadGalleryTarget } from '$lib/server/gallery';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals, params }) => loadGalleryTarget(params.target, locals.public);
