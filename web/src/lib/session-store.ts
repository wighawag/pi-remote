import {writable, get} from 'svelte/store';

export interface SessionInfo {
	path: string;
	id: string;
	name?: string;
	created: string;
	modified: string;
	messageCount: number;
	firstMessage: string;
	isActive: boolean;
	clientCount: number;
}

export interface FolderWithSessions {
	path: string;
	name: string;
	sessions: SessionInfo[];
}

export interface ConflictInfo {
	targetSessionId: string;
	conflictingSessionId: string;
	conflictingCwd: string;
}

export interface ModelInfo {
	provider: string;
	modelId: string;
	label: string;
	isDefault?: boolean;
}

export interface SessionStoreData {
	folders: FolderWithSessions[];
	activeSessions: string[];
	currentSession: string | null;
	loading: boolean;
}

export interface ModelsStoreData {
	models: ModelInfo[];
	loading: boolean;
}

export const sessionFolders = writable<SessionStoreData>({
	folders: [],
	activeSessions: [],
	currentSession: null,
	loading: false,
});

export const availableModels = writable<ModelsStoreData>({
	models: [],
	loading: false,
});

export function getBaseUrl(): string {
	const config = localStorage.getItem('wherever-config');
	const defaultHost =
		typeof window !== 'undefined' && window.location && window.location.hostname
			? window.location.hostname
			: 'localhost';

	if (config) {
		const parsed = JSON.parse(config);
		const protocol = window.location.protocol === 'https:' ? 'https:' : 'http:';
		let host = parsed.host || defaultHost;
		if (host === 'localhost' || host === '127.0.0.1') {
			if (
				defaultHost &&
				defaultHost !== 'localhost' &&
				defaultHost !== '127.0.0.1'
			) {
				host = defaultHost;
			}
		}
		host = host.startsWith('http') ? host.replace(/^wss?:\/\//, '') : host;
		return `${protocol}//${host}:${parsed.port || 31415}`;
	}
	return `${window.location.protocol}//${window.location.host}`;
}

let fetchTimeout: ReturnType<typeof setTimeout> | null = null;
let resolveQueue: (() => void)[] = [];

export function fetchSessions(): Promise<void> {
	if (fetchTimeout) {
		clearTimeout(fetchTimeout);
	}
	sessionFolders.update((s) => ({...s, loading: true}));

	const promise = new Promise<void>((resolve) => {
		resolveQueue.push(resolve);
	});

	fetchTimeout = setTimeout(async () => {
		fetchTimeout = null;
		const resolves = [...resolveQueue];
		resolveQueue = [];

		try {
			const baseUrl = getBaseUrl();
			const token = getToken();
			const url = `${baseUrl}/sessions${token ? `?token=${encodeURIComponent(token)}` : ''}`;
			const res = await fetch(url);
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const data = await res.json();
			sessionFolders.set({
				folders: data.folders || [],
				activeSessions: (data.activeSessions || []).map(
					(s: any) => s.sessionFile,
				),
				currentSession: get(sessionFolders).currentSession,
				loading: false,
			});
		} catch (err) {
			sessionFolders.update((s) => ({...s, loading: false}));
			console.error('Failed to fetch sessions:', err);
		} finally {
			for (const r of resolves) {
				r();
			}
		}
	}, 100);

	return promise;
}

export async function fetchModels(): Promise<void> {
	availableModels.update((s) => ({...s, loading: true}));
	try {
		const baseUrl = getBaseUrl();
		const token = getToken();
		const url = `${baseUrl}/models${token ? `?token=${encodeURIComponent(token)}` : ''}`;
		const res = await fetch(url);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const data = await res.json();
		availableModels.set({
			models: data.models || [],
			loading: false,
		});
	} catch (err) {
		availableModels.update((s) => ({...s, loading: false}));
		console.error('Failed to fetch models:', err);
	}
}

export function getToken(): string {
	try {
		const config = localStorage.getItem('wherever-config');
		if (config) {
			const parsed = JSON.parse(config);
			return parsed.token || '';
		}
	} catch {}
	return '';
}

export const gitInitDefaultStore = writable<boolean>(false);
export const uploadMethodStore = writable<'websocket' | 'post'>('websocket');
export const searchFolderStore = writable<string | null>(null);
export const searchCreateRemoteStore = writable<boolean>(false);

export interface PathCheckResult {
	exists: boolean;
	isGit: boolean;
	resolvedPath: string;
}

export async function checkPath(
	pathStr: string,
): Promise<PathCheckResult | null> {
	if (!pathStr.trim()) return null;
	try {
		const baseUrl = getBaseUrl();
		const token = getToken();
		const url = `${baseUrl}/check-path?path=${encodeURIComponent(pathStr)}${token ? `&token=${encodeURIComponent(token)}` : ''}`;
		const res = await fetch(url);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		return (await res.json()) as PathCheckResult;
	} catch (err) {
		console.error('Failed to check path:', err);
		return null;
	}
}

export interface PathAutocompleteResult {
	completions: string[];
}

export async function autocompletePath(pathStr: string): Promise<string[]> {
	try {
		const baseUrl = getBaseUrl();
		const token = getToken();
		const url = `${baseUrl}/autocomplete-path?path=${encodeURIComponent(pathStr)}${token ? `&token=${encodeURIComponent(token)}` : ''}`;
		const res = await fetch(url);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const data = (await res.json()) as PathAutocompleteResult;
		return data.completions || [];
	} catch (err) {
		console.error('Failed to autocomplete path:', err);
		return [];
	}
}

export async function fetchConfig(): Promise<void> {
	try {
		const baseUrl = getBaseUrl();
		const token = getToken();
		const url = `${baseUrl}/config${token ? `?token=${encodeURIComponent(token)}` : ''}`;
		const res = await fetch(url);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const data = await res.json();
		gitInitDefaultStore.set(!!data.gitInitDefault);
		uploadMethodStore.set(data.uploadMethod || 'websocket');
		searchFolderStore.set(data.searchFolder || null);
		searchCreateRemoteStore.set(!!data.searchCreateRemote);
	} catch (err) {
		console.error('Failed to fetch config:', err);
	}
}

export function setCurrentSession(sessionId: string | null): void {
	sessionFolders.update((s) => ({...s, currentSession: sessionId}));
}
