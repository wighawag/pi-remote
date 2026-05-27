import adapter from '@sveltejs/adapter-static';
import {vitePreprocess} from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),

	kit: {
		adapter: adapter({
			assets: 'build',
			pages: 'build',
		}),
		paths: {
			relative: true,
		},
		serviceWorker: {
			// we do not use it for now
			register: false,
		},
	},
};

export default config;
