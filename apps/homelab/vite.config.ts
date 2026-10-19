import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [sveltekit()],
	server: {
		// The markdown is read from the repository root (two levels up) by the server-side docs module;
		// `npm run dev` serves the live files and reloads when one changes.
		fs: { allow: ['../..'] }
	}
});
