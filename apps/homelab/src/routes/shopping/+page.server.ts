import { render } from '$lib/server/docs';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = () => ({ path: 'docs/shopping-list.md', html: render('docs/shopping-list.md') });
