import { error } from '@sveltejs/kit';
import { DOCS, render } from '$lib/server/docs';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ params }) => {
	const doc = DOCS.get(params.path);
	if (!doc) error(404, `No document ${params.path}`);
	return { path: doc.path, title: doc.title, html: render(doc.path) };
};
