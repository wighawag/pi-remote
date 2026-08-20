/**
 * Compose the message text that carries uploaded-file references to the agent.
 *
 * Uploads are server-side: the browser POSTs the bytes, the server writes them
 * to the upload dir and returns the saved path. The agent only ever learns
 * about a file through a `[Uploaded file: <path>]` line in the user message,
 * so this is the single place that shape is defined.
 *
 * Shared by the chat composer (upload first, then send) and the search flow
 * (create the session first, THEN upload, then send the query), which is why it
 * takes plain paths rather than the composer's attachment records.
 */
export function buildAttachmentMessage(text: string, paths: string[]): string {
	const trimmed = text.trim();
	if (paths.length === 0) return trimmed;
	const fileLines = paths.map((p) => `[Uploaded file: ${p}]`).join('\n');
	// With no prose of their own, the files ARE the message: name them
	// explicitly so the agent has an instruction rather than bare paths.
	return trimmed
		? `${trimmed}\n\n${fileLines}`
		: `I have uploaded the following file(s) for you:\n${fileLines}`;
}
