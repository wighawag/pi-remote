import tailwindcss from '@tailwindcss/vite';
import {defineConfig} from 'vite';
import {sveltekit} from '@sveltejs/kit/vite';

export default defineConfig({
	plugins: [tailwindcss(), sveltekit()],
	server: {
		host: '0.0.0.0',
		allowedHosts: true,
	},
	build: {
		emptyOutDir: true,
		minify: true,
		sourcemap: false,
	},
});
