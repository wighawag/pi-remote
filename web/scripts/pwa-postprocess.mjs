#!/usr/bin/env node
// Post-process the pwag output to add PWA `screenshots` entries (for Chrome's
// richer install UI), copied from committed source files under pwa-assets/.
//
// As of pwag 0.5.0, maskable icon generation AND explicit `purpose: "any"` on
// the regular icons are handled natively by pwag (driven by `maskable: true` in
// web-config.json). So this script no longer generates maskable icons and no
// longer rewrites the manifest `icons` array -- pwag already emits both the
// `any` and `maskable` entries correctly. This script now only copies
// screenshots and appends them to the manifest.
//
// pwag writes static/pwa/manifest.webmanifest (gitignored). Source assets that
// must survive a clean checkout live (committed) under web/pwa-assets/ --
// deliberately OUTSIDE static/ so SvelteKit does NOT serve the raw sources (only
// the generated copies under static/pwa/ are served).
//
// Requires ImageMagick (`identify`) only to read screenshot dimensions; this
// will be replaced by `sharp` in a follow-up so the whole pipeline has zero
// external (non-node) dependencies.

import {execFileSync} from 'node:child_process';
import {
	existsSync,
	readFileSync,
	writeFileSync,
	copyFileSync,
	mkdirSync,
} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const webDir = resolve(__dirname, '..');
const staticDir = join(webDir, 'static');
const pwaDir = join(staticDir, 'pwa');
// Committed source assets, intentionally outside static/ so they are not served.
const srcDir = join(webDir, 'pwa-assets');
const manifestPath = join(pwaDir, 'manifest.webmanifest');

function fail(msg) {
	console.error(`[pwa-postprocess] ${msg}`);
	process.exit(1);
}

if (!existsSync(manifestPath)) {
	fail(
		`manifest not found at ${manifestPath}. Run pwag first (pnpm generate-pwa-icons-and-tags).`,
	);
}

mkdirSync(pwaDir, {recursive: true});

// `identify` (ImageMagick) is only used to read screenshot dimensions and is the
// sole non-node dependency left. It is non-critical (screenshots only affect
// Chrome's richer install UI), so if it is missing we warn and skip screenshots
// rather than failing the build / `pnpm install`. Maskable icon generation no
// longer needs ImageMagick (it is native to pwag 0.5.0 via sharp), so a missing
// `identify` can never silently ship broken home-screen icons.
let identifyAvailable = true;
try {
	execFileSync('identify', ['--version'], {stdio: 'ignore'});
} catch {
	identifyAvailable = false;
	console.warn(
		'[pwa-postprocess] ImageMagick `identify` not found: skipping screenshots (install ImageMagick to enable Chrome richer install UI).',
	);
}

// --- Copy screenshots (committed sources -> gitignored static/pwa) ------------
const screenshots = [
	{
		src: join(srcDir, 'screenshots', 'desktop.png'),
		out: 'screenshot-desktop.png',
		form_factor: 'wide',
		label: 'Wherever dashboard on desktop',
	},
	{
		src: join(srcDir, 'screenshots', 'mobile.png'),
		out: 'screenshot-mobile.png',
		form_factor: 'narrow',
		label: 'Wherever dashboard on mobile',
	},
];

const manifestScreenshots = [];
for (const s of screenshots) {
	if (!identifyAvailable) break;
	if (!existsSync(s.src)) {
		console.warn(
			`[pwa-postprocess] screenshot source missing, skipping: ${s.src}`,
		);
		continue;
	}
	const outPath = join(pwaDir, s.out);
	copyFileSync(s.src, outPath);
	// Read dimensions via ImageMagick `identify`.
	const dims = execFileSync('identify', ['-format', '%wx%h', outPath])
		.toString()
		.trim();
	manifestScreenshots.push({
		src: s.out,
		sizes: dims,
		type: 'image/png',
		form_factor: s.form_factor,
		label: s.label,
	});
	console.log(
		`[pwa-postprocess] added screenshot ${s.out} (${dims}, ${s.form_factor})`,
	);
}

// --- Patch the manifest: append screenshots only (icons are pwag's job now) ---
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

if (manifestScreenshots.length > 0) {
	manifest.screenshots = manifestScreenshots;
} else {
	delete manifest.screenshots;
}

writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
console.log(`[pwa-postprocess] patched ${manifestPath}`);