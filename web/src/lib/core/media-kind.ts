// Media classification + the download/preview affordance predicate, extracted as
// pure, framework-agnostic logic so both ChatMessageList.svelte and the unit
// tests share one source of truth.
//
// Two concerns live here because they are the two halves of the same decision:
//   1. extractDownloadablePath() - WHICH tool calls get a download/preview
//      affordance at all, and WHAT single path it operates on.
//   2. mediaKind() - given such a path, WHAT kind of inline preview (if any) it
//      can drive, keyed purely by file extension (the path is already
//      server-validated, so no client-side MIME sniffing).

/**
 * The kind of inline media a downloadable path can render as, or null when it is
 * not a previewable media file (fall back to the download chip only).
 *
 * All three kinds are defined now even though the first slice only USES `image`,
 * so the later audio/video slices are pure additions to the render layer.
 */
export type MediaKind = 'image' | 'audio' | 'video';

// Extension → kind. Detection is by file EXTENSION only, case-insensitive; the
// server has already validated the path, so we never sniff bytes on the client.
const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'avif'];
const AUDIO_EXTS = ['mp3', 'wav', 'oga', 'ogg', 'm4a', 'aac', 'flac', 'opus'];
const VIDEO_EXTS = ['mp4', 'webm', 'mov', 'm4v', 'ogv'];

function extensionOf(path: string): string | null {
	if (!path || typeof path !== 'string') return null;
	// Consider only the final path segment so a dot in a directory name never
	// counts, and require a real extension after the last dot.
	const base = path.split(/[/\\]/).pop() || '';
	const dot = base.lastIndexOf('.');
	if (dot <= 0 || dot === base.length - 1) return null;
	return base.slice(dot + 1).toLowerCase();
}

/**
 * Classify a file path into an inline media kind by its extension
 * (case-insensitive), or null for anything else (including directory/search
 * paths, which have no media extension).
 */
export function mediaKind(path: string): MediaKind | null {
	const ext = extensionOf(path);
	if (!ext) return null;
	if (IMAGE_EXTS.includes(ext)) return 'image';
	if (AUDIO_EXTS.includes(ext)) return 'audio';
	if (VIDEO_EXTS.includes(ext)) return 'video';
	return null;
}

/**
 * Return the single file path a tool call operated on when it qualifies for the
 * download/preview affordance, else null. Narrowed to `read` + `attach_file`
 * ONLY: those are the two tools where a download/preview is meaningful — an
 * intentional attachment, or a file the agent read. `write`/`edit` are write-side
 * operations (offering a download of a file the agent just wrote is noise) and
 * are deliberately excluded, as are `ls`/`grep`/`find` (their path arg is a
 * directory or search scope, not a downloadable file). Suppressed on errors.
 */
export function extractDownloadablePath(
	toolName: string,
	argsObj: Record<string, any> | null,
	isError: boolean,
): string | null {
	if (isError || !argsObj) return null;
	const name = (toolName || '').toLowerCase();
	if (!['attach_file', 'read'].includes(name)) return null;
	const pathVal = argsObj.path || argsObj.filepath || argsObj.file;
	if (!pathVal || typeof pathVal !== 'string') return null;
	return pathVal.trim() || null;
}
