// Markdown rendering for assistant chat messages.
//
// Uses `marked` for GFM parsing and DOMPurify for sanitization. We deliberately
// keep this dependency-light: no syntax-highlighting engine is bundled (code
// blocks render as plain monospace, styled via the `prose` classes). The agent
// output is broadly trusted, but DOMPurify still runs as defense-in-depth so a
// stray `<script>`/`<img onerror>` in tool output or a pasted snippet cannot
// execute.

import {marked} from 'marked';
import DOMPurify from 'dompurify';

marked.setOptions({
	gfm: true,
	breaks: true,
});

// Open links in a new tab and harden them against reverse-tabnabbing. The hook
// runs after sanitization so the attributes survive.
let hookRegistered = false;
function ensureHook() {
	if (hookRegistered || typeof window === 'undefined') return;
	hookRegistered = true;
	DOMPurify.addHook('afterSanitizeAttributes', (node) => {
		if (node.tagName === 'A') {
			node.setAttribute('target', '_blank');
			node.setAttribute('rel', 'noopener noreferrer');
		}
	});
}

/**
 * Render a markdown string to sanitized HTML.
 *
 * Server-side (no DOM available) it returns the raw text escaped as-is, since
 * DOMPurify needs a window; the client re-renders on hydration anyway.
 */
export function renderMarkdown(raw: string): string {
	if (!raw) return '';
	const html = marked.parse(raw, {async: false}) as string;
	if (typeof window === 'undefined') {
		// No DOM to sanitize against during SSR. Return empty; the component shows
		// a plain-text fallback until the client hydrates and re-renders.
		return '';
	}
	ensureHook();
	return DOMPurify.sanitize(html, {
		ADD_ATTR: ['target', 'rel'],
	});
}
