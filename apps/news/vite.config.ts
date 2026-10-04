import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [sveltekit()],
	// Native module: keep it out of the SSR bundle.
	ssr: { external: ['sharp'] }
});
