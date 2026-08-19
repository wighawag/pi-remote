/**
 * Conversation-search snippets, as a pure module.
 *
 * The server ships each snippet exactly as SQLite FTS5 produced it: matched
 * terms are wrapped in \u0001 ... \u0002 (memonaut's `snippet()` markers). Those
 * control characters are used instead of HTML so the server never has to know
 * about markup and the transport can never carry an injection: turning them into
 * highlight spans is a rendering decision, made here.
 *
 * The result is a list of {text, match} segments the component renders with a
 * plain `{#each}` (no `{@html}`, so nothing from a transcript is ever parsed as
 * markup).
 */

export const MATCH_START = '\u0001';
export const MATCH_END = '\u0002';

export interface SnippetSegment {
	text: string;
	/** True when this segment is a matched term and should be highlighted. */
	match: boolean;
}

/**
 * Split an FTS5 snippet into plain/highlighted segments.
 *
 * Tolerates malformed input on purpose: an unterminated start marker highlights
 * to the end, a stray end marker is dropped, and text with no markers at all
 * comes back as a single plain segment. A snippet is display sugar, so it must
 * never be able to throw in the render path.
 */
export function snippetSegments(snippet: string): SnippetSegment[] {
	if (!snippet) return [];
	const segments: SnippetSegment[] = [];
	let rest = snippet;

	while (rest.length > 0) {
		const start = rest.indexOf(MATCH_START);
		if (start < 0) {
			push(segments, rest.split(MATCH_END).join(''), false);
			break;
		}
		push(segments, rest.slice(0, start).split(MATCH_END).join(''), false);
		rest = rest.slice(start + 1);
		const end = rest.indexOf(MATCH_END);
		if (end < 0) {
			push(segments, rest, true);
			break;
		}
		push(segments, rest.slice(0, end), true);
		rest = rest.slice(end + 1);
	}

	return segments;
}

function push(segments: SnippetSegment[], text: string, match: boolean): void {
	if (!text) return;
	segments.push({text, match});
}

/** The snippet with every marker removed (titles, tooltips, a11y labels). */
export function snippetPlainText(snippet: string): string {
	return snippetSegments(snippet)
		.map((s) => s.text)
		.join('');
}

/**
 * Short, human label for where a hit came from. `kind` is memonaut's chunk kind
 * (what the text IS) and is more informative than the raw role, which is why it
 * wins; the tool name is appended when the kind is a tool call.
 */
export function hitKindLabel(kind: string, tool?: string | null): string {
	switch (kind) {
		case 'user':
			return 'you';
		case 'assistant':
			return 'agent';
		case 'thinking':
			return 'thinking';
		case 'name':
			return 'session name';
		case 'summary':
			return 'summary';
		case 'bash':
			return 'bash';
		case 'toolCall':
			return tool ? `tool: ${tool}` : 'tool call';
		case 'toolResult':
			return tool ? `output: ${tool}` : 'tool output';
		default:
			return kind || 'entry';
	}
}

/** Compact relative age ("3d ago"), falling back to the raw string. */
export function relativeTime(iso: string | null, now = Date.now()): string {
	if (!iso) return '';
	const t = Date.parse(iso);
	if (Number.isNaN(t)) return '';
	const seconds = Math.max(0, Math.round((now - t) / 1000));
	if (seconds < 60) return 'just now';
	const minutes = Math.round(seconds / 60);
	if (minutes < 60) return `${minutes}m ago`;
	const hours = Math.round(minutes / 60);
	if (hours < 24) return `${hours}h ago`;
	const days = Math.round(hours / 24);
	if (days < 30) return `${days}d ago`;
	const months = Math.round(days / 30);
	if (months < 12) return `${months}mo ago`;
	return `${Math.round(months / 12)}y ago`;
}
