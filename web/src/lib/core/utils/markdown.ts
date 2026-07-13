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

// Max characters shown in the collapsed summary of a fenced code block before
// we truncate with an ellipsis. Keeps long pasted blobs from cluttering the log.
const CODE_SUMMARY_MAX = 80;

function escapeHtml(s: string): string {
	return s
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

// Render fenced code blocks as collapsible <details>. The summary shows the
// language (if any) plus the first non-empty line, truncated, so a long block
// collapses to a single unobtrusive line. Single-line blocks stay open (nothing
// gained by collapsing them). DOMPurify below is configured to allow the
// details/summary tags this produces.
const codeRenderer = {
	code(this: unknown, token: {text: string; lang?: string}): string {
		const {text, lang} = token;
		const langLabel = (lang ?? '').trim().split(/\s+/)[0] ?? '';
		const lines = text.split('\n');
		const nonEmpty = lines.filter((l) => l.trim() !== '');
		const multiline = nonEmpty.length > 1;
		const codeHtml = `<pre><code>${escapeHtml(text)}</code></pre>`;
		if (!multiline) {
			return codeHtml;
		}
		const firstLine = nonEmpty[0] ?? '';
		let summaryText = firstLine;
		if (summaryText.length > CODE_SUMMARY_MAX) {
			summaryText = summaryText.slice(0, CODE_SUMMARY_MAX) + '…';
		} else if (nonEmpty.length > 1) {
			summaryText += ' …';
		}
		const summaryLabel = langLabel
			? `<span class="code-lang">${escapeHtml(langLabel)}</span> ${escapeHtml(summaryText)}`
			: escapeHtml(summaryText);
		return `<details class="code-collapsible"><summary>${summaryLabel}</summary>${codeHtml}</details>`;
	},
};
marked.use({renderer: codeRenderer});

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
		ADD_TAGS: ['details', 'summary'],
	});
}

// GFM-ish autolink matcher for the link-only path. Matches http(s):// and www.
// URLs. Trailing punctuation that is usually sentence punctuation (not part of
// the URL) is trimmed off the match.
const URL_RE = /\b(https?:\/\/[^\s<]+|www\.[^\s<]+)/gi;

/**
 * Linkify plain text WITHOUT running full markdown. Used for user messages,
 * where we want bare URLs to be clickable but must not reinterpret characters
 * the user typed literally (asterisks, backticks, hashes). Everything is
 * HTML-escaped first, then only URL matches are wrapped in anchors, then the
 * whole thing is sanitized as defense-in-depth.
 *
 * Returns escaped-but-unlinked text server-side (no DOM for DOMPurify); the
 * client re-renders on hydration.
 */
export function linkifyText(raw: string): string {
	if (!raw) return '';
	if (typeof window === 'undefined') {
		return '';
	}
	let out = '';
	let lastIndex = 0;
	for (const match of raw.matchAll(URL_RE)) {
		const start = match.index ?? 0;
		out += escapeHtml(raw.slice(lastIndex, start));
		let urlText = match[0];
		// Trim trailing sentence punctuation that is unlikely to be part of the URL.
		let trailing = '';
		const trailMatch = urlText.match(/[.,;:!?)\]}'"]+$/);
		if (trailMatch) {
			trailing = trailMatch[0];
			urlText = urlText.slice(0, urlText.length - trailing.length);
		}
		const href = urlText.startsWith('www.') ? `https://${urlText}` : urlText;
		out += `<a href="${escapeHtml(href)}">${escapeHtml(urlText)}</a>`;
		out += escapeHtml(trailing);
		lastIndex = start + match[0].length;
	}
	out += escapeHtml(raw.slice(lastIndex));
	ensureHook();
	return DOMPurify.sanitize(out, {
		ADD_ATTR: ['target', 'rel'],
	});
}
