import {derived, get, writable} from 'svelte/store';
import {playInvitingBeep} from './core/beep';
import {
	WhereverClient,
	parseSkillInvocation,
	type ChatMessage,
	type WhereverState,
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
export {parseSkillInvocation};

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
	beepDefault?: boolean;
	beepSoundUrl?: string;
}) {
	localStorage.setItem('wherever-config', JSON.stringify(config));
}

// The port to use when the user has NOT explicitly configured one. When the
// dashboard is served from a real origin (e.g. behind a reverse proxy like
// Caddy on 443, or any host:port), connect back to THAT origin's port instead
// of assuming the dev default 31415. This makes reverse-proxy deployments
// (https://host with no port in the URL) work without the user having to know
// to type "443" into the port field. A direct LAN setup on http://ip:31415
// still resolves to 31415 because that is the page's own port. Falls back to
// 31415 only when there is no window (SSR) or no usable location port.
function defaultPort(): number {
	if (typeof window !== 'undefined' && window.location) {
		const loc = window.location;
		if (loc.port) return Number(loc.port);
		// No explicit port in the URL => standard port for the scheme.
		if (loc.protocol === 'https:') return 443;
		if (loc.protocol === 'http:') return 80;
	}
	return 31415;
}

export function getConfig() {
	const defaultHost =
		typeof window !== 'undefined' && window.location && window.location.hostname
			? window.location.hostname
			: 'localhost';

	const stored = getStoredConfig();
	if (stored) {
		// Legacy port healing: a config stored before reverse-proxy support has
		// port 31415 baked in. If the dashboard is actually served from a
		// different origin port (e.g. 443 behind Caddy), that stale 31415 makes
		// the client dial a closed port and hang on "Connecting...". When the
		// stored port is the legacy default AND the page's own port differs,
		// adopt the page's port so proxied deployments just work.
		if (
			(stored.port === 31415 || stored.port === undefined) &&
			defaultPort() !== 31415
		) {
			stored.port = defaultPort();
		}
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
		return {
			hideThinking: false,
			hideTools: false,
			beepDefault: false,
			beepSoundUrl: '',
			...stored,
		};
	}
	return {
		host: defaultHost,
		port: defaultPort(),
		token: '',
		hideThinking: false,
		hideTools: false,
		beepDefault: false,
		beepSoundUrl: '',
	};
}

// --- Waiting-for-human beep ------------------------------------------------
// The beep is DISABLED by default. A persisted config flag (beepDefault) sets
// the default for EVERY session. Each session can additionally hold its OWN
// explicit choice (a per-session override) that wins over the default.
//
// Key semantics ("unset" is a real, distinct state):
//   - A session with NO override "follows the default": change the default and
//     this session's effective beep state changes with it, live.
//   - Once the user explicitly sets the per-session control (on/off), that
//     choice STICKS to that session and is unaffected by later default changes,
//     until the user clears it back to "follow default".
//
// Overrides are therefore stored PER SESSION (keyed by the session id/file) and
// persisted, so a choice made in session A survives visiting session B and
// coming back, and survives a reload. Absence of a key = "follow default".
const beepDefaultStore = writable<boolean>(!!getConfig().beepDefault);

// Map<sessionKey, boolean> of explicit per-session choices, persisted to
// localStorage. A missing key means the session follows the default.
const BEEP_OVERRIDES_KEY = 'wherever-beep-overrides';

function loadBeepOverrides(): Record<string, boolean> {
	try {
		const raw = localStorage.getItem(BEEP_OVERRIDES_KEY);
		if (raw) {
			const parsed = JSON.parse(raw);
			if (parsed && typeof parsed === 'object') return parsed;
		}
	} catch {}
	return {};
}

function saveBeepOverrides(map: Record<string, boolean>) {
	try {
		localStorage.setItem(BEEP_OVERRIDES_KEY, JSON.stringify(map));
	} catch {}
}

const beepOverridesStore = writable<Record<string, boolean>>(
	typeof localStorage !== 'undefined' ? loadBeepOverrides() : {},
);
// The active session's key ('' when no session). Drives which override applies.
const beepSessionKeyStore = writable<string>('');

export function getBeepDefault(): boolean {
	return get(beepDefaultStore);
}

// Optional custom sound file/URL to play instead of the synthesized chime.
// Empty string means "use the built-in chime".
export function getBeepSoundUrl(): string {
	const url = getConfig().beepSoundUrl;
	return typeof url === 'string' ? url : '';
}

// Persist the custom beep sound URL (empty string clears it, reverting to the
// built-in chime).
export function setBeepSoundUrl(value: string) {
	const config = getConfig();
	saveConfig({...config, beepSoundUrl: value});
}

// The current session's explicit choice, or undefined when it follows the
// default. Tri-state: true | false | undefined. Lets the UI signal "not set".
export const beepSessionOverride = derived(
	[beepSessionKeyStore, beepOverridesStore],
	([$key, $overrides]) =>
		$key && $key in $overrides ? $overrides[$key] : undefined,
);

// True when the beep should sound for the current session: the per-session
// override if the session set one, otherwise the persisted default. Recomputes
// when the session, its override, or the default changes.
export const beepEnabled = derived(
	[beepSessionOverride, beepDefaultStore],
	([$override, $default]) => ($override === undefined ? $default : $override),
);

// Set (or clear) the beep default that applies to all sessions. Persists to
// config AND updates the reactive default store so beepEnabled recomputes.
export function setBeepDefault(value: boolean) {
	const config = getConfig();
	saveConfig({...config, beepDefault: value});
	beepDefaultStore.set(value);
}

// Set this session's explicit choice (true/false), or pass undefined to CLEAR
// it back to "follow the default". Persisted per session.
export function setBeepSessionOverride(value: boolean | undefined) {
	const key = get(beepSessionKeyStore);
	if (!key) return; // no active session to attach the choice to
	beepOverridesStore.update((map) => {
		const next = {...map};
		if (value === undefined) {
			delete next[key];
		} else {
			next[key] = value;
		}
		saveBeepOverrides(next);
		return next;
	});
}

// Point the beep state at a session (its id/file). Called when the active
// session changes. Does NOT clear any stored per-session choice: an unset
// session follows the default; a session with a stored choice keeps it.
export function setBeepSessionKey(key: string | null) {
	beepSessionKeyStore.set(key ?? '');
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

// --- Waiting-for-human beep trigger ----------------------------------------
// Watch the streaming flag and sound the inviting chime on the true -> false
// edge, i.e. the moment the agent stops working and is waiting for a human
// message. Gated by beepEnabled (per-session override or the persisted
// default). Also point the beep state at the active session when it changes, so
// beepEnabled reflects THAT session's stored choice (or the default if unset).
let prevIsStreaming = false;
let prevSessionKey: string | null = null;
state.subscribe((s) => {
	const sessionKey = s.sessionId ?? s.activeSessionFile ?? null;
	if (sessionKey !== prevSessionKey) {
		prevSessionKey = sessionKey;
		// New/changed session: retarget the beep state at it (its stored choice, if
		// any, else the default) and do not treat the session's initial streaming
		// state as a finished-turn edge.
		setBeepSessionKey(sessionKey);
		prevIsStreaming = s.isStreaming;
		return;
	}
	if (prevIsStreaming && !s.isStreaming) {
		// Only chime for a real session with a transcript, not for a bare
		// disconnect/leave that also drops isStreaming to false.
		if (sessionKey && get(beepEnabled)) {
			playInvitingBeep(getBeepSoundUrl());
		}
	}
	prevIsStreaming = s.isStreaming;
});

// When runSearch() creates a session, hold the query here until the matching
// session_created arrives, then send it as the first message of that session.
let pendingSearchQuery: string | null = null;

// Composer prefill: text to drop into the message box (to edit and send), used
// by the fork-at-user-message flow to mirror pi's `/fork` position:'before'
// (which hands you the forked-at message to edit and resend). The composer
// watches this store, applies the text to its textarea, and clears it. A bump
// counter guarantees the composer re-applies even when the same text is set
// twice in a row.
export const composerPrefill = writable<{text: string; bump: number}>({
	text: '',
	bump: 0,
});

export function prefillComposer(text: string) {
	composerPrefill.update((p) => ({text, bump: p.bump + 1}));
}

// After a `session_fork` succeeds, the server returns the new session file plus
// the forked-at message text. Hold that text here until the new session is
// created/loaded, then push it into the composer so it lands in the RIGHT
// (forked) session, not the source one.
let pendingForkPrefill: string | null = null;

// Sync WebSocket messages with Svelte session-store state side-effects
client.onMessage((msg) => {
	switch (msg.type) {
		case 'session_forked': {
			// The server created the branched session file. Load it (switching away
			// from the source), and stash the forked-at message text so it is dropped
			// into the composer once the new session is active.
			const forkedMsg = msg as {
				sessionFile: string;
				cwd: string;
				prefillText: string;
			};
			pendingForkPrefill = forkedMsg.prefillText ?? '';
			switchSession(forkedMsg.sessionFile, forkedMsg.cwd);
			break;
		}

		case 'session_created':
			setCurrentSession(msg.sessionFile);
			if (pendingForkPrefill !== null) {
				const text = pendingForkPrefill;
				pendingForkPrefill = null;
				// Defer so the composer has hydrated the (empty) new-session draft
				// before we overwrite it with the forked-at text.
				queueMicrotask(() => prefillComposer(text));
			}
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
			// Likewise, a failed fork must not leak its prefill into a later session.
			pendingForkPrefill = null;
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

// True when the client still holds an active session to rejoin in place (from an
// explicit suspend OR an unsolicited drop). Lets the page prefer the
// preserve-cache resume() path over a session-wiping fresh connect() on return.
export function hasActiveSession(): boolean {
	return client.hasActiveSession();
}

// --- Native file-picker guard ---------------------------------------------
// Opening the OS file picker / camera backgrounds the page, which fires
// `visibilitychange: hidden`. If the user lingers (taking a photo, browsing
// files), the background suspend timer would otherwise fire and tear down the
// session, so the subsequent upload fails with "No active session". Components
// flag the picker as active so the visibility handler skips suspending while a
// picker is open. A timestamp guards against the flag getting stuck if the
// change event never arrives (e.g. the user cancels the picker on some
// platforms).
let filePickerActiveUntil = 0;
const FILE_PICKER_GRACE_MS = 5 * 60 * 1000;

export function beginFilePicker() {
	filePickerActiveUntil = Date.now() + FILE_PICKER_GRACE_MS;
}

export function endFilePicker() {
	filePickerActiveUntil = 0;
}

export function isFilePickerActive(): boolean {
	return Date.now() < filePickerActiveUntil;
}

export function sendMessage(text: string): boolean {
	return client.sendMessage(text);
}

// Retry a user message whose delivery could not be confirmed (delivery:
// 'failed'). Returns false if it could not be handed to a live socket.
export function resendMessage(messageId: string): boolean {
	return client.resendMessage(messageId);
}

// Drop an undelivered user message the user chooses not to resend.
export function discardMessage(messageId: string): void {
	client.discardMessage(messageId);
}

export function abort() {
	client.abort();
}

// Cancel the queued mid-stream steer messages for the active session, retracting
// a steer the user regrets WITHOUT aborting the in-flight turn. Only meaningful
// for server-type sessions (the ones that report a steer queue).
export function cancelSteer() {
	client.cancelSteer();
}

export function joinSession(sessionFile: string, cwd?: string, model?: string) {
	client.joinSession(sessionFile, cwd, model);
}

// Atomically leave the current session (if any) and load another one. Preferred
// over a manual leaveSession()+joinSession() dance: it has no in-between gap that
// could strand the "Loading session..." spinner. Always rearms the load watchdog
// for the new target, so the latest tap wins.
export function switchSession(
	sessionFile: string,
	cwd?: string,
	model?: string,
) {
	client.switchSession(sessionFile, cwd, model);
}

// Fork the given session at a specific user-message entry (pi's `/fork`,
// position 'before'). The server creates the branched session file and replies
// with `session_forked`, which the onMessage handler above turns into a switch
// to the new session + a composer prefill of the forked-at message text.
export function forkSession(sessionId: string, entryId: string) {
	client.forkSession(sessionId, entryId);
}

export function createSession(
	cwd: string,
	model?: string,
	gitInit?: boolean,
	createRemote?: boolean,
	repoVisibility?: 'private' | 'public',
	cloneRemote?: boolean,
) {
	client.createSession(
		cwd,
		model,
		gitInit,
		createRemote,
		repoVisibility,
		cloneRemote,
	);
}

/**
 * Run a web search: create a fresh session in the configured search folder and,
 * once it is created, send the query as the first message. Each search is a new
 * session, grouped in the sidebar under the search folder. When `model` is
 * omitted the server default (folder-local config) is used. Returns false
 * (no-op) if no search folder is configured.
 */
export function runSearch(query: string, model?: string): boolean {
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
		model || undefined,
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

// "Continue anyway" on the folder-conflict warning banner: enable the composer
// for this session even though another session in the same folder is active. It
// does NOT abort the other session.
export function continueFolderConflict() {
	client.continueFolderConflict();
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
	beepDefault?: boolean;
	beepSoundUrl?: string;
}) {
	saveConfig(config);
	// beepDefault/beepSoundUrl are frontend-only preferences; the client config
	// has no such fields, so forward only the fields it understands.
	const {host, port, token, hideThinking, hideTools} = config;
	client.setConfig({host, port, token, hideThinking, hideTools});
	// Keep the reactive beep-default store in sync so beepEnabled recomputes when
	// the Config menu changes the default (this is the path the settings UI uses,
	// not setBeepDefault). Only when the field is actually present in this update.
	if (config.beepDefault !== undefined) {
		beepDefaultStore.set(!!config.beepDefault);
	}
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

export function dismissNotice() {
	client.dismissNotice();
}

// Submit the password for a pending `!sudo ...` command. The password is sent
// straight to the server and never kept in client state.
export function sendSudoPassword(password: string) {
	client.sendSudoPassword(password);
}

// Dismiss the pending sudo prompt without running the command.
export function cancelSudoPrompt() {
	client.cancelSudoPrompt();
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
// Folder-conflict warning-banner state (null when there is no conflict).
export const folderConflict = derived(piState, ($s) => $s.folderConflict);
export const isInterrupted = derived(piState, ($s) => $s.isInterrupted);
// The mid-stream steer messages still queued on the server (not yet injected).
// A user bubble whose content appears here is a pending steer the user can
// cancel. Empty when nothing is queued.
export const pendingSteering = derived(piState, ($s) => $s.pendingSteering);
export const sessionError = derived(piState, ($s) => $s.sessionError);
// A dismissible, non-fatal session notice (e.g. a CLI took over this session
// while it was mid-turn here, discarding the in-flight tool call or streaming
// reply). Rendered as a banner.
export const sessionNotice = derived(piState, ($s) => $s.notice);
// A pending `!sudo ...` password prompt for the active session (or null). Drives
// the masked SudoPasswordDialog.
export const sudoPrompt = derived(piState, ($s) => $s.sudoPrompt);
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
// True after a fast-first (cold) session load: the conversation is readable but
// the live agent is still building, so sending must stay blocked until ready.
export const isAgentPending = derived(piState, ($s) => $s.agentPending);
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

/**
 * Build an authenticated URL for GET /session/download. The server streams the
 * file with Content-Disposition: attachment, validating `path` against the
 * session's allowed download roots. `path` is the server-provided (already
 * validated) path echoed back verbatim. Returns null when there is no active
 * session to attribute the download to.
 */
export function downloadFileUrl(path: string): string | null {
	const state = get(piState);
	const sessionId = state.sessionId;
	if (!sessionId) return null;
	const baseUrl = getBaseUrl();
	const token = getToken();
	return (
		`${baseUrl}/session/download` +
		`?sessionId=${encodeURIComponent(sessionId)}` +
		`&path=${encodeURIComponent(path)}` +
		(token ? `&token=${encodeURIComponent(token)}` : '')
	);
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
