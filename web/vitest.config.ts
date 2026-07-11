import {defineConfig} from 'vitest/config';

// Standalone vitest config that deliberately does NOT load the SvelteKit vite
// plugin (vite.config.ts). These are fast, pure-TS unit tests for the app's
// framework-agnostic logic (e.g. src/lib/core/*). Loading the SvelteKit plugin
// would spin up a dev-server pipeline we do not need and pulls in a conflicting
// vite version. Component-level tests (if added later) would use their own
// jsdom + svelte setup.
export default defineConfig({
	test: {
		include: ['src/**/*.test.ts'],
		environment: 'node',
	},
});
