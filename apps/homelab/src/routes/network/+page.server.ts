import { componentLinks, docHref, render, section } from '$lib/server/docs';
import type { PageServerLoad } from './$types';

/** The network reference, quoted from the docs it lives in (one source; edit those files). */
const REFERENCE: { path: string; headings: (string | null)[] }[] = [
	{ path: 'docs/other-site-network.md', headings: [null, 'Address plan'] },
	{ path: 'apps/README.md', headings: ['Hostnames'] },
	{ path: 'platform/README.md', headings: ['Network'] }
];

export const load: PageServerLoad = () => ({
	links: componentLinks(),
	reference: REFERENCE.map(({ path, headings }) => ({
		path,
		href: docHref(path),
		html: render(path, headings.map((h) => section(path, h)).join('\n\n'))
	}))
});
