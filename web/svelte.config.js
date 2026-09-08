import adapter from '@sveltejs/adapter-static';
import {execSync} from 'node:child_process';
import {vitePreprocess} from '@sveltejs/vite-plugin-svelte';

let VERSION = `timestamp_${Date.now()}`;
// An out-of-tree builder (Nix, CI from a tarball) has no .git to ask, and the
// timestamp fallback would make every build produce a different artifact. Let it
// state the version it is building instead, so the build stays reproducible and
// the dashboard still reports a meaningful build id.
const STAMPED_VERSION = process.env.WHEREVER_BUILD_VERSION?.trim();
if (STAMPED_VERSION) {
	VERSION = STAMPED_VERSION;
} else {
	try {
		VERSION = execSync('git rev-parse --short HEAD', {
			stdio: ['ignore', 'pipe', 'ignore'],
		})
			.toString()
			.trim();
		try {
			// This command returns empty string if no changes
			const output = execSync('git status --porcelain', {encoding: 'utf8'});
			if (output.trim().length > 0) {
				VERSION += '-dirty';
				console.warn(`[!] repo has some uncommited changes...`);
			}
		} catch (error) {
			console.error('Error checking git status:', error);
			process.exit(1);
		}
	} catch (e) {
		console.error(e);
	}
}

/** @type {import('@sveltejs/kit').Config} */
const config = {
	// Consult https://svelte.dev/docs/kit/integrations
	// for more information about preprocessors
	preprocess: vitePreprocess(),

	kit: {
		version: {
			name: VERSION,
		},
		adapter: adapter({
			assets: 'build',
			pages: 'build',
		}),
		serviceWorker: {
			// we handle it ourselves here : src/service-worker-handler.ts
			register: false,
		},
		paths: {
			// this is to make it work on ipfs (on an unknown path)
			relative: true,
		},
	},
};

export default config;
