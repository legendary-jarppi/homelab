import { render } from '$lib/server/docs';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = () => ({ path: 'docs/future-plans.md', html: render('docs/future-plans.md') });
