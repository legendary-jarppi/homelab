import { DOCS, docHref } from '$lib/server/docs';
import type { PageServerLoad } from './$types';

/** Every bundled markdown file, grouped by top-level directory. */
export const load: PageServerLoad = () => {
	const sections: { name: string; docs: { path: string; title: string; href: string }[] }[] = [];
	for (const d of DOCS.values()) {
		const name = d.path.includes('/') ? d.path.split('/')[0] : 'repository';
		let s = sections.find((x) => x.name === name);
		if (!s) sections.push((s = { name, docs: [] }));
		s.docs.push({ path: d.path, title: d.title, href: docHref(d.path) });
	}
	return { sections };
};
