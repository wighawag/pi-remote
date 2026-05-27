import {writable, derived, get} from 'svelte/store';
import type {ConflictInfo} from './session-store';
import {
	setCurrentSession,
	getBaseUrl,
	getToken,
	uploadMethodStore,
	fetchSessions,
} from './session-store';

export interface ChatMessage {
	id: string;
	role: 'user' | 'assistant' | 'thinking' | 'tool';
	content: string;
	timestamp: number;
	isStreaming?: boolean;
	sessionId?: string;
	toolName?: string;
	toolArgs?: string;
	toolOutput?: string;
	isError?: boolean;
}

export interface PiRemoteState {
	connected: boolean;
	connecting: boolean;
	error: string | null;
	session: string | null;
	sessionId: string | null;
	isStreaming: boolean;
	messages: ChatMessage[];
	clientId: string | null;
	conflict: ConflictInfo | null;
	isInterrupted: boolean;
	sessionError: string | null;
	readOnly: boolean;
	activeSessionFile: string | null;
	activeCwd: string | null;
	activeModel: string | null;
	hideThinking: boolean;
	hideTools: boolean;
}

const defaultState: PiRemoteState = {
	connected: false,
	connecting: false,
	error: null,
	session: null,
	sessionId: null,
	isStreaming: false,
	messages: [],
	clientId: null,
	conflict: null,
	isInterrupted: false,
	sessionError: null,
	readOnly: false,
	activeSessionFile: null,
	activeCwd: null,
	activeModel: null,
	hideThinking: false,
	hideTools: false,
};

const state = writable<PiRemoteState>({
	...defaultState,
	hideThinking: typeof window !== 'undefined' ? !!getConfig().hideThinking : false,
	hideTools: typeof window !== 'undefined' ? !!getConfig().hideTools : false,
});
let ws: WebSocket | null = null;
const pendingUploads = new Map<
	string,
	{resolve: (val: any) => void; reject: (err: any) => void}
>();
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let agentEndTimeout: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_DELAY = 3000;

function generateId() {
	return Math.random().toString(36).substring(2) + Date.now().toString(36);
}

function getStoredConfig() {
	try {
		const stored = localStorage.getItem('pi-remote-config');
		if (stored) return JSON.parse(stored);
	} catch {}
	return null;
}

function saveConfig(config: {host: string; port: number; token: string; hideThinking?: boolean; hideTools?: boolean}) {
	localStorage.setItem('pi-remote-config', JSON.stringify(config));
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
				return {hideThinking: false, hideTools: false, ...stored, host: defaultHost};
			}
		}
		if (!stored.host) {
			stored.host = defaultHost;
		}
		return {hideThinking: false, hideTools: false, ...stored};
	}
	return {host: defaultHost, port: 31415, token: '', hideThinking: false, hideTools: false};
}

function buildUrl(config: {host: string; port: number; token: string}) {
	const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
	const host = config.host.startsWith('http')
		? config.host.replace(/^https?:\/\//, '')
		: config.host;
	const token = config.token
		? `?token=${encodeURIComponent(config.token)}`
		: '';
	return `${protocol}//${host}:${config.port}/ws${token}`;
}

function addMessage(msg: Omit<ChatMessage, 'id' | 'timestamp'>) {
	const message: ChatMessage = {
		...msg,
		id: generateId(),
		timestamp: Date.now(),
	};
	state.update((s: PiRemoteState) => ({
		...s,
		messages: [...s.messages, message],
	}));
	return message.id;
}

export function connect() {
	const config = getConfig();
	const url = buildUrl(config);

	saveConfig(config);

	state.set({
		...defaultState,
		connecting: true,
		hideThinking: !!config.hideThinking,
		hideTools: !!config.hideTools,
	});

	try {
		ws = new WebSocket(url);
	} catch (err) {
		state.set({
			...defaultState,
			error: `Failed to connect: ${err}`,
			hideThinking: !!config.hideThinking,
			hideTools: !!config.hideTools,
		});
		return;
	}

	ws.onopen = () => {
		reconnectAttempts = 0;
	};

	ws.onmessage = (event) => {
		try {
			const msg = JSON.parse(event.data);

			switch (msg.type) {
				case 'connected':
					state.update((s: PiRemoteState) => ({
						...s,
						connected: true,
						connecting: false,
						clientId: msg.clientId,
						error: null,
					}));
					break;

				case 'file_uploaded': {
					const pending = pendingUploads.get(msg.uploadId);
					if (pending) {
						pending.resolve({savedPath: msg.savedPath, filename: msg.filename});
						pendingUploads.delete(msg.uploadId);
					}
					break;
				}

				case 'file_upload_error': {
					const pending = pendingUploads.get(msg.uploadId);
					if (pending) {
						pending.reject(new Error(msg.error));
						pendingUploads.delete(msg.uploadId);
					}
					break;
				}

				case 'agent_start':
					if (agentEndTimeout) {
						clearTimeout(agentEndTimeout);
						agentEndTimeout = null;
					}
					state.update((s: PiRemoteState) => ({...s, isStreaming: true}));
					break;

				case 'thinking_update':
					state.update((s: PiRemoteState) => {
						let lastThinking = [...s.messages]
							.reverse()
							.find((m: ChatMessage) => m.role === 'thinking' && m.isStreaming);
						if (!lastThinking) {
							const newMsg: ChatMessage = {
								id: generateId(),
								role: 'thinking',
								content: msg.delta,
								timestamp: Date.now(),
								isStreaming: true,
							};
							return {...s, messages: [...s.messages, newMsg]};
						}
						return {
							...s,
							messages: s.messages.map((m: ChatMessage) =>
								m.id === lastThinking.id
									? {...m, content: m.content + msg.delta, isStreaming: true}
									: m,
							),
						};
					});
					break;

				case 'message_update':
					state.update((s: PiRemoteState) => {
						let lastAssistant = [...s.messages]
							.reverse()
							.find(
								(m: ChatMessage) => m.role === 'assistant' && m.isStreaming,
							);
						if (!lastAssistant) {
							// No streaming message — create one (mid-agent-cycle thinking)
							const newMsg: ChatMessage = {
								id: generateId(),
								role: 'assistant',
								content: msg.delta,
								timestamp: Date.now(),
								isStreaming: true,
							};
							return {...s, messages: [...s.messages, newMsg]};
						}
						return {
							...s,
							messages: s.messages.map((m: ChatMessage) =>
								m.id === lastAssistant.id
									? {...m, content: m.content + msg.delta, isStreaming: true}
									: m,
							),
						};
					});
					break;

				case 'message_end':
					state.update((s: PiRemoteState) => {
						let newMessages = s.messages;

						// Finalize any streaming thinking message
						const lastThinking = [...newMessages]
							.reverse()
							.find((m: ChatMessage) => m.role === 'thinking' && m.isStreaming);
						if (lastThinking) {
							newMessages = newMessages.map((m: ChatMessage) =>
								m.id === lastThinking.id ? {...m, isStreaming: false} : m,
							);
						}

						// Finalize any streaming assistant message
						const lastAssistant = [...newMessages]
							.reverse()
							.find(
								(m: ChatMessage) => m.role === 'assistant' && m.isStreaming,
							);
						if (lastAssistant) {
							newMessages = newMessages.map((m: ChatMessage) =>
								m.id === lastAssistant.id
									? {
											...m,
											content: msg.content || m.content,
											isStreaming: false,
										}
									: m,
							);
						} else if (msg.content) {
							// Deduplicate user messages: if the message is from the user, and our last user message matches, do not append it again
							const lastUserMessage = [...newMessages]
								.reverse()
								.find((m) => m.role === 'user');
							const isDuplicateUserMsg =
								msg.role === 'user' &&
								lastUserMessage &&
								lastUserMessage.content === msg.content;

							if (!isDuplicateUserMsg) {
								newMessages = [
									...newMessages,
									{
										id: generateId(),
										role: msg.role || 'assistant',
										content: msg.content,
										timestamp: Date.now(),
										isStreaming: false,
									},
								];
							}
						}

						return {...s, messages: newMessages};
					});
					break;

				case 'agent_end':
					if (agentEndTimeout) {
						clearTimeout(agentEndTimeout);
						agentEndTimeout = null;
					}
					agentEndTimeout = setTimeout(() => {
						state.update((s: PiRemoteState) => ({
							...s,
							isStreaming: false,
							messages: s.messages.map((m: ChatMessage) =>
								m.isStreaming ? {...m, isStreaming: false} : m,
							),
						}));
						agentEndTimeout = null;
					}, 300);
					break;

				case 'tool_start':
					if (agentEndTimeout) {
						clearTimeout(agentEndTimeout);
						agentEndTimeout = null;
					}
					const toolArgs = msg.args
						? Object.entries(msg.args)
								.filter(([k, v]) => v !== undefined && v !== '')
								.map(([k, v]) => `${k}=${JSON.stringify(v)}`)
								.join(' ')
						: '';
					state.update((s: PiRemoteState) => {
						// Finalize any streaming assistant or thinking messages
						const finalizedMessages = s.messages.map((m: ChatMessage) =>
							m.isStreaming && (m.role === 'assistant' || m.role === 'thinking')
								? {...m, isStreaming: false}
								: m,
						);
						const newMsg: ChatMessage = {
							id: generateId(),
							role: 'tool',
							content: toolArgs
								? `$ ${msg.toolName} ${toolArgs}`
								: `$ ${msg.toolName}`,
							timestamp: Date.now(),
							isStreaming: true,
							toolName: msg.toolName,
							toolArgs: toolArgs,
							toolOutput: '',
						};
						return {
							...s,
							messages: [...finalizedMessages, newMsg],
						};
					});
					break;

				case 'tool_update': {
					const current = get(state);
					const toolMsg = [...current.messages]
						.reverse()
						.find(
							(m: ChatMessage) =>
								m.role === 'tool' &&
								m.toolName === msg.toolName &&
								m.isStreaming,
						);
					if (toolMsg) {
						state.update((s: PiRemoteState) => ({
							...s,
							messages: s.messages.map((m: ChatMessage) =>
								m.id === toolMsg.id
									? {
											...m,
											content: m.content.includes('\n')
												? m.content + msg.delta
												: `${m.content}\n${msg.delta}`,
											toolOutput: `${m.toolOutput}${msg.delta}`,
										}
									: m,
							),
						}));
					}
					break;
				}

				case 'tool_end': {
					const current = get(state);
					const toolMsg = [...current.messages]
						.reverse()
						.find(
							(m: ChatMessage) =>
								m.role === 'tool' &&
								m.toolName === msg.toolName &&
								!m.content.startsWith('Tool error:'),
						);
					const result = msg.result ? `${msg.result}` : '';
					if (toolMsg) {
						const errorPrefix = msg.isError ? 'Error: ' : '';
						state.update((s: PiRemoteState) => ({
							...s,
							messages: s.messages.map((m: ChatMessage) =>
								m.id === toolMsg.id
									? {
											...m,
											content: `${errorPrefix}${m.content}\n${result}`,
											isStreaming: false,
											isError: msg.isError,
											toolOutput: result,
										}
									: m,
							),
						}));
					} else {
						// No matching tool message — add standalone result
						const content = msg.isError
							? `Tool error: ${msg.toolName}\n${result}`
							: `${msg.toolName}\n${result}`;
						addMessage({
							role: 'tool',
							content,
							isStreaming: false,
							toolName: msg.toolName,
							toolArgs: '',
							toolOutput: result,
							isError: msg.isError,
						});
					}
					break;
				}

				case 'aborted':
					state.update((s: PiRemoteState) => ({
						...s,
						isStreaming: false,
						messages: s.messages.map((m: ChatMessage) =>
							m.isStreaming ? {...m, isStreaming: false} : m,
						),
					}));
					break;

				case 'session_created':
					state.update((s: PiRemoteState) => ({
						...s,
						session: msg.sessionFile,
						sessionId: msg.sessionId,
						activeSessionFile: msg.sessionFile,
						activeCwd: msg.cwd,
						activeModel: msg.model,
						isStreaming: msg.isStreaming ?? false,
					}));
					setCurrentSession(msg.sessionFile);
					break;

				case 'session_destroyed':
					state.update((s: PiRemoteState) => {
						if (s.sessionId === msg.sessionId) {
							return {
								...s,
								messages: [],
								session: null,
								sessionId: null,
								activeSessionFile: null,
								activeCwd: null,
								activeModel: null,
							};
						}
						return s;
					});
					setCurrentSession(null);
					break;

				case 'sessions_updated':
					fetchSessions();
					break;

				case 'session_error':
					state.update((s: PiRemoteState) => ({
						...s,
						sessionError: msg.error,
						isStreaming: false,
					}));
					break;

				case 'session_conflict':
					state.update((s: PiRemoteState) => ({
						...s,
						conflict: {
							targetSessionId: msg.sessionId,
							conflictingSessionId: msg.conflictingSession,
							conflictingCwd: msg.conflictingCwd,
						},
					}));
					break;

				case 'session_interrupted':
					state.update((s: PiRemoteState) => ({
						...s,
						isInterrupted: true,
						readOnly: true,
						messages: [],
						session: null,
						sessionId: null,
						activeSessionFile: null,
						activeCwd: null,
						activeModel: null,
					}));
					setCurrentSession(null);
					setTimeout(() => {
						state.update((s: PiRemoteState) => ({
							...s,
							isInterrupted: false,
							readOnly: false,
						}));
					}, 5000);
					break;

				case 'message_history':
					state.update((s: PiRemoteState) => {
						const mapped: ChatMessage[] = [];
						const pendingCalls: Record<string, string[]> = {};

						for (const m of msg.messages) {
							if (m.role === 'tool_call') {
								const tName = m.toolName || 'unknown';
								if (!pendingCalls[tName]) {
									pendingCalls[tName] = [];
								}
								pendingCalls[tName].push(m.content || '');
							} else if (m.role === 'tool_result') {
								const tName = m.toolName || 'unknown';
								const tArgs =
									pendingCalls[tName] && pendingCalls[tName].length > 0
										? pendingCalls[tName].shift()!
										: '';
								mapped.push({
									id: generateId(),
									role: 'tool',
									content: tArgs
										? `$ ${tName} ${tArgs}\n${m.content}`
										: `$ ${tName}\n${m.content}`,
									timestamp: m.timestamp,
									isStreaming: false,
									toolName: tName,
									toolArgs: tArgs,
									toolOutput: m.content,
									isError: m.isError,
									sessionId: msg.sessionId,
								});
							} else {
								mapped.push({
									id: generateId(),
									role: m.role,
									content: m.content,
									timestamp: m.timestamp,
									isStreaming: false,
									toolName: m.toolName,
									sessionId: msg.sessionId,
								});
							}
						}

						// Add any pending tool calls that didn't have a result yet
						for (const [tName, argsList] of Object.entries(pendingCalls)) {
							for (const args of argsList) {
								mapped.push({
									id: generateId(),
									role: 'tool',
									content: args ? `$ ${tName} ${args}` : `$ ${tName}`,
									timestamp:
										mapped.length > 0
											? mapped[mapped.length - 1].timestamp + 1
											: Date.now(),
									isStreaming: s.isStreaming,
									toolName: tName,
									toolArgs: args,
									toolOutput: '',
									sessionId: msg.sessionId,
								});
							}
						}

						// If the session is currently streaming and the last message in history is assistant or thinking, mark it as streaming
						if (s.isStreaming && mapped.length > 0) {
							const lastIndex = mapped.length - 1;
							const lastMsg = mapped[lastIndex];
							if (lastMsg.role === 'assistant' || lastMsg.role === 'thinking') {
								mapped[lastIndex] = {
									...lastMsg,
									isStreaming: true,
								};
							}
						}

						return {...s, messages: mapped};
					});
					break;

				case 'pong':
					break;

				case 'model_changed':
					state.update((s: PiRemoteState) => ({
						...s,
						activeModel: msg.model,
					}));
					break;
			}
		} catch (err) {
			console.error('Failed to parse WebSocket message:', err);
		}
	};

	ws.onclose = () => {
		ws = null;
		state.update((s: PiRemoteState) => ({
			...s,
			connected: false,
			connecting: false,
		}));

		if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
			reconnectAttempts++;
			reconnectTimer = setTimeout(() => {
				state.update((s: PiRemoteState) => ({
					...s,
					connecting: true,
					error: 'Reconnecting...',
				}));
				connect();
			}, RECONNECT_DELAY);
		} else {
			const config = getConfig();
			state.set({
				...defaultState,
				error: 'Connection lost. Check your settings and try again.',
				hideThinking: !!config.hideThinking,
				hideTools: !!config.hideTools,
			});
		}
	};

	ws.onerror = () => {
		state.update((s: PiRemoteState) => ({
			...s,
			error: s.error || 'Connection error occurred',
		}));
	};
}

export function disconnect() {
	if (reconnectTimer) {
		clearTimeout(reconnectTimer);
		reconnectTimer = null;
	}
	reconnectAttempts = MAX_RECONNECT_ATTEMPTS;
	if (ws) {
		ws.close();
		ws = null;
	}
	const config = getConfig();
	state.set({
		...defaultState,
		hideThinking: !!config.hideThinking,
		hideTools: !!config.hideTools,
	});
	setCurrentSession(null);
}

export function sendMessage(text: string) {
	if (!ws || ws.readyState !== WebSocket.OPEN) return;
	const s = get(state);
	if (!s.sessionId) return;

	// Clear any previous session errors when a new message is sent
	state.update((s: PiRemoteState) => ({...s, sessionError: null}));

	addMessage({
		role: 'user',
		content: text,
		isStreaming: false,
		sessionId: s.sessionId,
	});

	ws.send(
		JSON.stringify({type: 'message', message: text, sessionId: s.sessionId}),
	);
}

export function abort() {
	if (!ws || ws.readyState !== WebSocket.OPEN) return;
	const s = get(state);
	if (!s.sessionId) return;
	ws.send(JSON.stringify({type: 'abort', sessionId: s.sessionId}));
}

export function joinSession(sessionFile: string, cwd?: string, model?: string) {
	if (!ws || ws.readyState !== WebSocket.OPEN) return;
	state.update((s: PiRemoteState) => ({
		...s,
		conflict: null,
		sessionError: null,
	}));
	ws.send(JSON.stringify({type: 'session_load', sessionFile, cwd, model}));
}

export function createSession(
	cwd: string,
	model?: string,
	gitInit?: boolean,
	createRemote?: boolean,
	repoVisibility?: 'private' | 'public',
) {
	state.update((s: PiRemoteState) => ({
		...s,
		conflict: null,
		sessionError: null,
	}));
	if (!ws || ws.readyState !== WebSocket.OPEN) return;
	ws.send(
		JSON.stringify({
			type: 'session_new',
			cwd,
			model,
			gitInit,
			createRemote,
			repoVisibility,
		}),
	);
}

export function leaveSession() {
	if (!ws || ws.readyState !== WebSocket.OPEN) return;
	const s = get(state);
	if (!s.sessionId) return;
	ws.send(JSON.stringify({type: 'session_leave', sessionId: s.sessionId}));
	state.update((s: PiRemoteState) => ({
		...s,
		messages: [],
		session: null,
		sessionId: null,
		activeSessionFile: null,
		activeCwd: null,
		activeModel: null,
		readOnly: false,
	}));
	setCurrentSession(null);
}

export function resolveConflict(
	action: 'take_over' | 'read_only',
	cwd?: string,
) {
	if (!ws || ws.readyState !== WebSocket.OPEN) return;
	const s = get(state);
	if (!s.conflict) return;

	ws.send(
		JSON.stringify({
			type: 'session_resolve_conflict',
			action,
			sessionId: s.conflict.targetSessionId,
			cwd: cwd || s.conflict.conflictingCwd,
		}),
	);

	state.update((s: PiRemoteState) => ({
		...s,
		conflict: null,
		readOnly: action === 'read_only',
	}));
}

export function ping() {
	if (!ws || ws.readyState !== WebSocket.OPEN) return;
	ws.send(JSON.stringify({type: 'ping'}));
}

export function clearMessages() {
	state.update((s: PiRemoteState) => ({...s, messages: []}));
}

export function setConfig(config: {host: string; port: number; token: string; hideThinking?: boolean; hideTools?: boolean}) {
	saveConfig(config);
	state.update((s: PiRemoteState) => {
		const next = {...s};
		if (config.hideThinking !== undefined) next.hideThinking = !!config.hideThinking;
		if (config.hideTools !== undefined) next.hideTools = !!config.hideTools;
		return next;
	});
}

export function dismissSessionError() {
	state.update((s: PiRemoteState) => ({...s, sessionError: null}));
}

export function changeModel(model: string) {
	if (!ws || ws.readyState !== WebSocket.OPEN) return;
	ws.send(JSON.stringify({type: 'model_change', model}));
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

async function uploadFileViaPost(
	sessionId: string,
	file: File,
): Promise<{savedPath: string; filename: string}> {
	const baseUrl = getBaseUrl();
	const token = getToken();
	const url = `${baseUrl}/session/upload?sessionId=${encodeURIComponent(sessionId)}&filename=${encodeURIComponent(file.name)}${token ? `&token=${encodeURIComponent(token)}` : ''}`;

	// Read file fully into memory as ArrayBuffer before sending to bypass mobile file sandbox/lazy-loading streaming issues
	const fileData = await file.arrayBuffer();

	const res = await fetch(url, {
		method: 'POST',
		headers: {
			'Content-Type': 'text/plain', // CORS-simple content type to bypass mobile preflight strict-origin blocks
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
		if (!ws || ws.readyState !== WebSocket.OPEN) {
			reject(new Error('WebSocket is not connected'));
			return;
		}

		try {
			const reader = new FileReader();
			reader.onload = () => {
				try {
					const result = reader.result as string;
					const base64Data = result.split(',')[1] || '';

					const uploadId = generateId();
					pendingUploads.set(uploadId, {resolve, reject});

					ws!.send(
						JSON.stringify({
							type: 'file_upload',
							uploadId,
							sessionId,
							filename: file.name,
							data: base64Data,
						}),
					);
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
