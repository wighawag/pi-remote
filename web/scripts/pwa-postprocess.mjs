#!/usr/bin/env node
// Post-process the pwag output to add things pwag does not generate natively:
//   1. A padded "maskable" icon (rendered from static/logo.svg on a solid
//      background with a safe-zone margin) so the installed app icon looks good
//      inside Android's circular/rounded mask instead of being clipped.
//   2. PWA `screenshots` entries (for Chrome's richer install UI) copied from
//      committed source files under static/pwa-src/.
//
// pwag writes static/pwa/manifest.webmanifest (gitignored). We mutate the
// generated icons array + add screenshots, and emit the extra image files into
// the same gitignored static/pwa/ folder. Source assets that must survive a
// clean checkout live (committed) under web/pwa-assets/ -- deliberately OUTSIDE
// static/ so SvelteKit does NOT serve the raw sources (only the generated
// copies under static/pwa/ are served).
//
// Requires ImageMagick (`convert`) which is already used in this environment.

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
const logoSvg = join(staticDir, 'logo.svg');

// Background used behind the (transparent, thin-stroke) logo for the maskable
// icon. Matches the app theme/background color.
const MASKABLE_BG = '#000000';
// Safe zone: the logo must fit within the inner ~80% (Android masks ~10% on
// each side). We render the logo at ~62% of the canvas, centered.
// Generate maskable icons at both launcher sizes: some browsers (notably
// Firefox Android) prefer/expect a maskable icon at 192, not only 512.
const MASKABLE_SIZES = [192, 512];
const LOGO_SCALE = 0.62;

function fail(msg) {
	console.error(`[pwa-postprocess] ${msg}`);
	process.exit(1);
}

if (!existsSync(manifestPath)) {
	fail(
		`manifest not found at ${manifestPath}. Run pwag first (pnpm generate-pwa-icons-and-tags).`,
	);
}
if (!existsSync(logoSvg)) {
	fail(`logo source not found at ${logoSvg}.`);
}

mkdirSync(pwaDir, {recursive: true});

// --- 1. Generate padded maskable icons (192 + 512) from the logo -------------
const maskableIcons = [];
for (const size of MASKABLE_SIZES) {
	const name = `maskable-${size}.png`;
	const outPath = join(pwaDir, name);
	const logoSize = Math.round(size * LOGO_SCALE);
	try {
		// Render the SVG logo to a transparent PNG at the inner size, then
		// composite it centered onto a solid-color size x size background.
		const tmpLogo = join(pwaDir, `.logo-tmp-${size}.png`);
		execFileSync('convert', [
			'-background',
			'none',
			'-density',
			'384',
			'-resize',
			`${logoSize}x${logoSize}`,
			logoSvg,
			tmpLogo,
		]);
		execFileSync('convert', [
			'-size',
			`${size}x${size}`,
			`xc:${MASKABLE_BG}`,
			tmpLogo,
			'-gravity',
			'center',
			'-composite',
			outPath,
		]);
		execFileSync('rm', ['-f', tmpLogo]);
		maskableIcons.push({
			src: name,
			type: 'image/png',
			sizes: `${size}x${size}`,
			purpose: 'maskable',
		});
		console.log(`[pwa-postprocess] wrote ${name}`);
	} catch (err) {
		fail(`failed to generate maskable icon ${name}: ${err.message}`);
	}
}

// --- 2. Copy screenshots (committed sources -> gitignored static/pwa) --------
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
	const entry = {
		src: s.out,
		sizes: dims,
		type: 'image/png',
		form_factor: s.form_factor,
		label: s.label,
	};
	manifestScreenshots.push(entry);
	console.log(
		`[pwa-postprocess] added screenshot ${s.out} (${dims}, ${s.form_factor})`,
	);
}

// --- 3. Patch the manifest ---------------------------------------------------
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

// Keep the non-maskable (regular) icons pwag produced, and give them an
// explicit `purpose: "any"`. Although the spec defaults missing purpose to
// "any", some browsers (notably Firefox Android) are more reliable at adopting
// the icon when it is explicit, instead of falling back to a generated letter
// icon.
manifest.icons = (manifest.icons || [])
	.filter((i) => !(i.purpose && i.purpose.includes('maskable')))
	.map((i) => ({...i, purpose: i.purpose || 'any'}));

// Append the generated maskable icons (192 + 512).
manifest.icons.push(...maskableIcons);

if (manifestScreenshots.length > 0) {
	manifest.screenshots = manifestScreenshots;
}

writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
console.log(`[pwa-postprocess] patched ${manifestPath}`);
