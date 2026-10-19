import adapter from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
export default {
	preprocess: vitePreprocess(),
	kit: {
		adapter: adapter({ out: 'build' }),
		alias: {
			// The repository root: the READMEs and docs/*.md bundled at build time ($lib/server/docs.ts).
			// In the repo that is ../..; deploy.sh stages the same layout for the image build.
			$repo: '../..'
		}
	}
};
