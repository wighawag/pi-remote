import {derived, get} from 'svelte/store';
import {
	WhereverClient,
	type ChatMessage,
	type WhereverState,
	type ConflictInfo,
} from '@wherever-dev/client';
import {
	setCurrentSession,
	getBaseUrl,
	getToken,
	uploadMethodStore,
	fetchSessions,
	searchFolderStore,
	searchCreateRemoteStore,
} from './session-store';

export type {ChatMessage, WhereverState};

function getStoredConfig() {
	try {
		const stored = localStorage.getItem('wherever-config');
		if (stored) return JSON.parse(stored);
	} catch {}
	return null;
}

function saveConfig(config: {
	host: string;
	port: number;
	token: string;
	hideThinking?: boolean;
	hideTools?: boolean;
}) {
	localStorage.setItem('wherever-config', JSON.stringify(config));
}

export function getConfig() {
	const defaultHost =
		typeof window !== 'undefined' && window.location && window.location.hostname
			? window.location.hostname
			: 'localhost';

	const stored = getStoredConfig();
	if (stored) {
		if (
			!stored.host ||
			stored.host === 'localhost' ||
			stored.host === '127.0.0.1'
		) {
			if (
				defaultHost &&
				defaultHost !== 'localhost' &&
				defaultHost !== '127.0.0.1'
			) {
				return {
					hideThinking: false,
					hideTools: false,
					...stored,
					host: defaultHost,
				};
			}
		}
		if (!stored.host) {
			stored.host = defaultHost;
		}
		return {hideThinking: false, hideTools: false, ...stored};
	}
	return {
		host: defaultHost,
		port: 31415,
		token: '',
		hideThinking: false,
		hideTools: false,
	};
}

// Instantiate the isomorphic WhereverClient
const initialConfig = getConfig();
export const client = new WhereverClient({
	host: initialConfig.host,
	port: initialConfig.port,
	token: initialConfig.token,
	secure:
		typeof window !== 'undefined' &&
		window.location &&
		window.location.protocol === 'https:',
	hideThinking: !!initialConfig.hideThinking,
	hideTools: !!initialConfig.hideTools,
});

export const state = client.stateStore;

// When runSearch() creates a session, hold the query here until the matching
// session_created arrives, then send it as the first message of that session.
let pendingSearchQuery: string | null = null;

// Sync WebSocket messages with Svelte session-store state side-effects
client.onMessage((msg) => {
	switch (msg.type) {
		case 'session_created':
			setCurrentSession(msg.sessionFile);
			if (pendingSearchQuery !== null) {
				const query = pendingSearchQuery;
				pendingSearchQuery = null;
				// App onMessage listeners run BEFORE the client's internal switch
				// sets sessionId on its state store, and sendMessage() drops the
				// message when sessionId is still null. Defer to the next microtask
				// so the store is populated before we send the query.
				queueMicrotask(() => client.sendMessage(query));
			}
			break;

		case 'session_error':
			// A search that failed to create a session must not leave a stale
			// pending query that would fire on the next unrelated session.
			pendingSearchQuery = null;
			break;

		case 'session_destroyed':
			const s = get(state);
			if (s.sessionId === msg.sessionId) {
				setCurrentSession(null);
			}
			break;

		case 'sessions_updated':
			fetchSessions();
			break;

		case 'session_interrupted':
			setCurrentSession(null);
			break;
	}
});

export function connect() {
	const config = getConfig();
	saveConfig(config);

	const isSecure =
		typeof window !== 'undefined' &&
		window.location &&
		window.location.protocol === 'https:';

	client.connect({
		host: config.host,
		port: config.port,
		token: config.token,
		secure: isSecure,
		hideThinking: !!config.hideThinking,
		hideTools: !!config.hideTools,
	});
}

export function disconnect() {
	client.disconnect(true);
	setCurrentSession(null);
}

// Suspend the connection on tab-background without dropping the cached session.
// Keeps messages/sessionId in the store so returning resyncs in place instead of
// reloading. Deliberately does NOT clear the current session.
export function suspend() {
	client.suspend();
}

// Resume after suspend(): reconnect preserving the cache and rejoin the active
// session. The store's resyncing flag drives the UI's reconnecting affordance.
export function resume() {
	client.resume();
}

// True when a session was recorded for resume (i.e. the tab was suspended with an
// active session). Lets callers choose the resume path only when there is
// actually something to rejoin, and otherwise do a plain connect.
export function hasSuspendedSession(): boolean {
	return client.hasSuspendedSession();
}

export function sendMessage(text: string) {
	client.sendMessage(text);
}

export function abort() {
	client.abort();
}

export function joinSession(sessionFile: string, cwd?: string, model?: string) {
	client.joinSession(sessionFile, cwd, model);
}

export function createSession(
	cwd: string,
	model?: string,
	gitInit?: boolean,
	createRemote?: boolean,
	repoVisibility?: 'private' | 'public',
) {
	client.createSession(cwd, model, gitInit, createRemote, repoVisibility);
}

/**
 * Run a web search: create a fresh session in the configured search folder and,
 * once it is created, send the query as the first message. Each search is a new
 * session, grouped in the sidebar under the search folder. Uses the server
 * default model. Returns false (no-op) if no search folder is configured.
 */
export function runSearch(query: string): boolean {
	const trimmed = query.trim();
	if (!trimmed) return false;
	const folder = get(searchFolderStore);
	if (!folder) return false;
	const createRemote = get(searchCreateRemoteStore);
	pendingSearchQuery = trimmed;
	// model omitted -> server default. gitInit follows remote intent.
	// repoVisibility forced to 'private' when a remote is created.
	client.createSession(
		folder,
		undefined,
		createRemote,
		createRemote,
		createRemote ? 'private' : undefined,
	);
	return true;
}

export function leaveSession() {
	client.leaveSession();
	setCurrentSession(null);
}

export function loadMoreHistory() {
	client.loadMoreHistory();
}

export function resolveConflict(
	action: 'take_over' | 'read_only',
	cwd?: string,
) {
	client.resolveConflict(action, cwd);
}

export function ping() {
	client.ping();
}

export function clearMessages() {
	client.clearMessages();
}

export function setConfig(config: {
	host: string;
	port: number;
	token: string;
	hideThinking?: boolean;
	hideTools?: boolean;
}) {
	saveConfig(config);
	client.setConfig(config);
}

export function updateConfig(updates: {
	hideThinking?: boolean;
	hideTools?: boolean;
}) {
	const config = getConfig();
	const newConfig = {...config, ...updates};
	saveConfig(newConfig);
	client.setConfig(newConfig);
}

export function dismissSessionError() {
	client.dismissSessionError();
}

export function changeModel(model: string) {
	client.changeModel(model);
}

export const piState = derived(state, ($s) => $s);
export const isConnected = derived(piState, ($s) => $s.connected);
export const isStreaming = derived(piState, ($s) => $s.isStreaming);
export const messages = derived(piState, ($s) => $s.messages);
export const connectionError = derived(piState, ($s) => $s.error);
export const currentSession = derived(piState, ($s) => $s.session);
export const conflict = derived(piState, ($s) => $s.conflict);
export const isInterrupted = derived(piState, ($s) => $s.isInterrupted);
export const sessionError = derived(piState, ($s) => $s.sessionError);
export const isReadOnly = derived(piState, ($s) => $s.readOnly);
export const activeSessionInfo = derived(piState, ($s) => ({
	sessionFile: $s.activeSessionFile,
	cwd: $s.activeCwd,
	model: $s.activeModel,
	sessionId: $s.sessionId,
}));
export const contextUsage = derived(piState, ($s) => $s.contextUsage);
export const isCreatingSession = derived(piState, ($s) => $s.creatingSession);
export const isLoadingSession = derived(piState, ($s) => $s.loadingSession);
export const isResyncing = derived(piState, ($s) => $s.resyncing);
export const hasMoreHistory = derived(piState, ($s) => $s.historyOffset > 0);
export const isLoadingMoreHistory = derived(
	piState,
	($s) => $s.loadingMoreHistory,
);

async function uploadFileViaPost(
	sessionId: string,
	file: File,
): Promise<{savedPath: string; filename: string}> {
	const baseUrl = getBaseUrl();
	const token = getToken();
	const url = `${baseUrl}/session/upload?sessionId=${encodeURIComponent(sessionId)}&filename=${encodeURIComponent(file.name)}${token ? `&token=${encodeURIComponent(token)}` : ''}`;

	const fileData = await file.arrayBuffer();

	const res = await fetch(url, {
		method: 'POST',
		headers: {
			'Content-Type': 'text/plain',
		},
		body: fileData,
	});

	if (!res.ok) {
		const errData = await res.json().catch(() => ({}));
		throw new Error(errData.error || `Upload failed with status ${res.status}`);
	}

	return await res.json();
}

function uploadFileViaWebSocket(
	sessionId: string,
	file: File,
): Promise<{savedPath: string; filename: string}> {
	return new Promise((resolve, reject) => {
		try {
			const reader = new FileReader();
			reader.onload = () => {
				try {
					const result = reader.result as string;
					const base64Data = result.split(',')[1] || '';

					client
						.uploadFileViaWebSocket(sessionId, file.name, base64Data)
						.then(resolve)
						.catch(reject);
				} catch (err) {
					reject(
						new Error(`Failed to process file data: ${(err as Error).message}`),
					);
				}
			};
			reader.onerror = () => {
				reject(new Error('Failed to read file contents'));
			};
			reader.readAsDataURL(file);
		} catch (err) {
			reject(err);
		}
	});
}

export async function uploadFile(
	sessionId: string,
	file: File,
): Promise<{savedPath: string; filename: string}> {
	const method = get(uploadMethodStore);
	if (method === 'post') {
		return uploadFileViaPost(sessionId, file);
	} else {
		return uploadFileViaWebSocket(sessionId, file);
	}
}

export async function deleteSession(sessionFile: string): Promise<void> {
	try {
		const baseUrl = getBaseUrl();
		const token = getToken();
		const url = `${baseUrl}/session/delete${token ? `?token=${encodeURIComponent(token)}` : ''}`;

		const res = await fetch(url, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({sessionFile}),
		});

		if (!res.ok) {
			const errData = await res.json().catch(() => ({}));
			throw new Error(
				errData.error || `Delete failed with status ${res.status}`,
			);
		}
	} catch (err) {
		console.error('Failed to delete session:', err);
		throw err;
	}
}
