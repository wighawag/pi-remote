import { derived, get } from 'svelte/store';
import { WhereverClient, type ChatMessage, type WhereverState, type ConflictInfo } from "@wherever-dev/client";
import {
	setCurrentSession,
	getBaseUrl,
	getToken,
	uploadMethodStore,
	fetchSessions,
} from './session-store';

export type { ChatMessage, WhereverState };

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
	secure: typeof window !== 'undefined' && window.location && window.location.protocol === 'https:',
	hideThinking: !!initialConfig.hideThinking,
	hideTools: !!initialConfig.hideTools,
});

export const state = client.stateStore;

// Sync WebSocket messages with Svelte session-store state side-effects
client.onMessage((msg) => {
	switch (msg.type) {
		case 'session_created':
			setCurrentSession(msg.sessionFile);
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

	const isSecure = typeof window !== 'undefined' && window.location && window.location.protocol === 'https:';

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

export function leaveSession() {
	client.leaveSession();
	setCurrentSession(null);
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
export const isCreatingSession = derived(piState, ($s) => $s.creatingSession);

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

					client.uploadFileViaWebSocket(sessionId, file.name, base64Data)
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
