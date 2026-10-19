import { loadGallery } from '$lib/server/gallery';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => loadGallery(locals.public);
