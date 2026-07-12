import {writable, get} from 'svelte/store';

export interface SessionInfo {
	path: string;
	id: string;
	name?: string;
	created: string;
	modified: string;
	messageCount: number;
	// Short, capped preview of the first user message (not the full text).
	firstMessage: string;
	isActive: boolean;
	clientCount: number;
}

export interface FolderWithSessions {
	path: string;
	name: string;
	sessions: SessionInfo[];
	readOnly?: boolean;
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

// Separate store for the read-only sessions page (sessions.readOnly folders),
// fetched on demand via /sessions?view=readonly. Kept distinct from the main
// list so the default dashboard payload stays small.
export const readOnlySessionFolders = writable<SessionStoreData>({
	folders: [],
	activeSessions: [],
	currentSession: null,
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
// In-flight + coalescing guards: a stream of `sessions_updated` events (one per
// agent turn) used to pull the whole list repeatedly. We now (a) never run two
// fetches at once, (b) collapse any requests that arrive during a fetch into a
// single trailing re-fetch, and (c) cap the debounce reset so a continuous
// stream still resolves promptly instead of being pushed back forever.
let fetchInFlight = false;
let refetchRequested = false;
let firstQueuedAt = 0;
const FETCH_DEBOUNCE_MS = 150;
const FETCH_MAX_WAIT_MS = 1000;

async function doFetchSessions(): Promise<void> {
	fetchInFlight = true;
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
		fetchInFlight = false;
	}
}

export function fetchSessions(): Promise<void> {
	sessionFolders.update((s) => ({...s, loading: true}));

	const promise = new Promise<void>((resolve) => {
		resolveQueue.push(resolve);
	});

	// If a fetch is already running, just mark that we need one more pass when it
	// finishes (collapsing any number of mid-flight requests into a single one).
	if (fetchInFlight) {
		refetchRequested = true;
		return promise;
	}

	const now = Date.now();
	if (!fetchTimeout) {
		firstQueuedAt = now;
	} else {
		clearTimeout(fetchTimeout);
		// Cap the debounce: if we have already been waiting MAX_WAIT, fire now
		// rather than letting a continuous event stream postpone the fetch forever.
		if (now - firstQueuedAt >= FETCH_MAX_WAIT_MS) {
			fetchTimeout = null;
			void runQueuedFetch();
			return promise;
		}
	}

	fetchTimeout = setTimeout(() => {
		fetchTimeout = null;
		void runQueuedFetch();
	}, FETCH_DEBOUNCE_MS);

	return promise;
}

async function runQueuedFetch(): Promise<void> {
	const resolves = [...resolveQueue];
	resolveQueue = [];
	try {
		await doFetchSessions();
		// A request that arrived mid-flight collapses into exactly one re-fetch.
		while (refetchRequested) {
			refetchRequested = false;
			await doFetchSessions();
		}
	} finally {
		for (const r of resolves) r();
	}
}

// Fetch the read-only session folders (sessions.readOnly) for the separate
// read-only page. Deliberately simple (no debounce/coalesce): it is only
// triggered while that page is open, not on the hot dashboard path.
export async function fetchReadOnlySessions(): Promise<void> {
	readOnlySessionFolders.update((s) => ({...s, loading: true}));
	try {
		const baseUrl = getBaseUrl();
		const token = getToken();
		const url = `${baseUrl}/sessions?view=readonly${token ? `&token=${encodeURIComponent(token)}` : ''}`;
		const res = await fetch(url);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const data = await res.json();
		readOnlySessionFolders.set({
			folders: data.folders || [],
			activeSessions: (data.activeSessions || []).map(
				(s: any) => s.sessionFile,
			),
			currentSession: get(readOnlySessionFolders).currentSession,
			loading: false,
		});
	} catch (err) {
		readOnlySessionFolders.update((s) => ({...s, loading: false}));
		console.error('Failed to fetch read-only sessions:', err);
	}
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
// Default model (as "provider:modelId") for the configured search folder,
// resolved server-side against that folder's settings. null when unset.
export const searchDefaultModelStore = writable<string | null>(null);

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
		searchDefaultModelStore.set(data.searchDefaultModel || null);
	} catch (err) {
		console.error('Failed to fetch config:', err);
	}
}

export function setCurrentSession(sessionId: string | null): void {
	sessionFolders.update((s) => ({...s, currentSession: sessionId}));
}
