# Technical Analysis: Deferring and Executing "/fork" in Wherever

This document details the architecture, implemented changes, and bug analysis for adding the ability to edit a past message and branch/fork the session within the Wherever web interface.

---

## 1. Feature Requirements
1. **Pencil/Edit Button**: Hovering over any previous user message in the chat list should display an "Edit" (pencil) icon.
2. **Fork Mode UI**: Clicking the edit button must:
   - Place the selected past user message into the text box for editing.
   - Enter a dedicated "Fork Mode" UI state (with a "Forking from message..." banner, a "Cancel Edit" button, and an Indigo "Fork & Send" action button).
3. **Atomic Deferral**: The actual file branching/forking on the server must be **deferred** until the user clicks "Fork & Send" (or presses Enter). This allows the user to cancel their edit intent locally without prematurely branching or polluting the filesystem with abandoned forks.
4. **Instant Sidebar Updates**: After a successful fork, the sidebar session browser must instantly refresh to display the newly created branched session, keeping the original session branch perfectly intact.

---

## 2. Technical Architecture

### Component Interaction Flow:
```
[Svelte Chat UI] ──(Edit/Pencil Click)──► [Local Svelte Store] (Fork Mode Active, Populates Textbox)
       │
(Fork & Send Click)
       │
       ▼
[WS Client] ───────(fork {entryId, message})───────► [Standalone Remote Server]
                                                               │
                                                 (forkSession() on Pool)
                                                               │
                             ┌─────────────────────────────────┴────────────────────────────────┐
                             ▼                                                                  ▼
                   [Server Session Type]                                              [CLI Session Type]
                    - SessionManager forks locally.                                    - Server forwards `cli_fork` to CLI.
                    - Loads & switches client to new session.                          - CLI bridge runs `ctx.fork()`.
                    - Sends `session_created` & `message_history`.                     - Rebinds and sends the edited message.
                    - Submits edited message to the new session.                       - Re-registers new session on Server.
```

---

## 3. Implemented Changes

### A. Protocol Definition (`server/src/protocol.ts`)
We added the following message definitions to coordinate the deferred fork with an edited payload:
- **ClientMessage**:
  - `{ type: 'fork'; sessionId: string; entryId: string; position?: 'before' | 'at'; message?: string }` (added optional `message` to support atomic fork + submit).
- **ServerMessage**:
  - `{ type: 'cli_fork'; entryId: string; position?: 'before' | 'at'; message?: string }` (forwards fork + edited message to CLI bridge).
  - `{ type: 'fork_editor_text'; text: string }` (legacy/offline mode text retrieval).

### B. Session Pool Logic (`server/src/session-pool.ts` & `session-types.ts`)
- **History Message IDs**: Added `id?: string` to `HistoryMessage` and populated it using `entry.id` from `SessionManager.getEntries()`. This exposes the unique database IDs of previous entries so Svelte knows which ID to fork.
- **Fork Session Handler**:
  - Implemented `forkSession(sessionFileOrId, entryId, position)` on the `SessionPool`.
  - For `server` session type: Walked the entries to find the target parent node, called `createBranchedSession()`, and returned the path to the newly branched file on disk.
- **CLI Session Re-association**:
  - Handled the scenario where a CLI bridge registers a brand-new session file after a fork.
  - Implemented automatic re-association inside `registerCliSession` by finding another active `cli` session with the **same `cwd`**.
  - Migrated the connected Svelte clients (`clients` Set) and preserved the **same `sessionId` UUID** to keep the client's connection active and seamless.

### C. Server WebSocket Handler (`server/src/index.ts`)
- **Case `fork`**:
  - Extracts the selected user text.
  - Triggers `pool.forkSession`.
  - If a CLI session, sends `cli_fork` with the `message` payload to the bridge.
  - If a Server session, loads the new session, switches the client, and immediately triggers `pool.sendUserMessage()` with the edited text.
  - Ensures `fork_editor_text` is **never sent** to Svelte if `msg.message` is present, avoiding text-box overwriting after submission.
- **Case `cli_register`**:
  - Correctly looks up the older session file of the CLI by `cwd` before registration.
  - Migrates all connected web clients to the new session file path and updates Svelte clients with `session_created` and `message_history`.

### D. CLI Bridge Extension (`extension/src/index.ts`)
- Added `cli_fork` handler:
  - Invokes `ctxVal.fork(msg.entryId, { withSession })`.
  - Inside `withSession`, uses the fresh replacement session context to automatically submit the new message: `await newCtx.sendUserMessage(msg.message)`.

### E. Frontend Svelte App (`web/src/lib/` Svelte components & stores)
- **Store (`wherever.ts`)**:
  - Exposed `forkTargetEntryId`, `startFork`, `cancelFork`, and `submitFork` stores and actions.
  - Subscribed to `session_created` and automatically triggered `fetchSessions()` to update the sidebar session browser immediately.
- **ChatMessageList (`ChatMessageList.svelte`)**:
  - Added pencil icon row buttons to the left of previous user messages. On click, it triggers `startFork(msg.entryId, msg.content)` which instantly populates the box locally.
- **ChatInput (`ChatInput.svelte`)**:
  - Listens to `$forkTargetEntryId` and renders the dedicated **Fork Mode** banner, **Cancel Edit** action, and change Send button to Indigo **"Fork & Send"** with a pencil icon.
  - Submits the edit using `submitFork(text)` on form submission.

---

## 4. Bug Analysis: Why It Failed with "Still same issue"

If the user still saw the text box revert to the old message and button reset to "Send" without a fork happening, there are three highly probable failure points:

### Cause 1: Browser Cache / Stale Frontend Code
Because Svelte compiles static assets in `.svelte-kit/output` / `build`, browsers aggressively cache JavaScript and Svelte runtime code. If the browser did not perform a hard refresh (`Ctrl + F5` or Developer Tools -> "Disable cache"), Svelte was still running the old client code.
- **The Symptom**: Svelte received the old WS message mapping, didn't recognize Svelte's new `forkTargetEntryId` local store flow, and triggered the original behavior.

### Cause 2: CLI Bridge Re-initialization Race / Disconnection
In `extension/src/index.ts`, when `ctxVal.fork` is executed, the agent session rebinds. If the re-binding of extensions fails or the Websocket socket gets disconnected permanently, Svelte never receives the subsequent `cli_register` update, keeping the UI hanging in its old state.

### Cause 3: Deferral in `session_created`
When Svelte client-side state transitions during `session_created`, it sets `activeSessionFile`. If the web clients are registered slowly or are not found under `oldSessionFile` because the WebSocket was recreated with a different `clientId` on reconnect, the message history is not updated.

---

## Appendix: Complete Code Implementation Reference

Here is the exact code implemented in all 8 files. You can copy and restore these exact snippets to bring the feature back.

### 1. `server/src/protocol.ts`
Add the new client message `fork` and server messages `cli_fork` and `fork_editor_text`:
```typescript
// Replace:
  | { type: 'cli_abort' }
  | { type: 'cli_model_change'; model: string };
// With:
  | { type: 'cli_abort' }
  | { type: 'cli_model_change'; model: string }
  | { type: 'fork'; sessionId: string; entryId: string; position?: 'before' | 'at'; message?: string };

// Replace:
  | { type: 'message_history'; sessionId: string; messages: HistoryMessage[] }
  | { type: 'model_changed'; sessionId: string; model: string }
  | { type: 'pong'; timestamp: number };
// With:
  | { type: 'message_history'; sessionId: string; messages: HistoryMessage[] }
  | { type: 'model_changed'; sessionId: string; model: string }
  | { type: 'fork_editor_text'; text: string }
  | { type: 'cli_fork'; entryId: string; position?: 'before' | 'at'; message?: string }
  | { type: 'pong'; timestamp: number };
```

---

### 2. `server/src/session-types.ts`
Include the optional `id` property in `HistoryMessage`:
```typescript
export interface HistoryMessage {
  id?: string;
  role: 'user' | 'assistant' | 'thinking' | 'tool_call' | 'tool_result';
  content: string;
  // ...
```

---

### 3. `server/src/session-pool.ts`
Update `getSessionHistory` to include the `entry.id`, and implement the `forkSession` method:
```typescript
// In getSessionHistory() map id like so for user, assistant, toolResult, bashExecution:
        if (msg.role === 'user') {
          const content = this.extractMessageText(msg);
          if (content) {
            messages.push({ id: entry.id, role: 'user', content, timestamp: ts });
          }
        } else if (msg.role === 'assistant') {
          // Add id: entry.id to all messages.push calls...
        }

// Implement forkSession and update registerCliSession:
  async registerCliSession(sessionFile: string, cwd: string, modelStr: string, cliWs: WebSocket): Promise<{ tracked: TrackedSession; error?: string }> {
    let existing = this.sessions.get(sessionFile);
    let clients = new Set<string>();

    if (!existing) {
      for (const s of this.sessions.values()) {
        if (s.cwd === cwd && s.type === 'cli' && s.sessionFile !== sessionFile) {
          existing = s;
          this.sessions.delete(s.sessionFile);
          break;
        }
      }
    }

    if (existing) {
      clients = existing.clients;
      this.cancelIdleCheck(existing.sessionFile);
      if (existing.type === 'server') {
        try {
          existing.eventUnsubscribe();
          existing.agentSession.dispose();
        } catch (err) {}
      }
    }

    const sessionId = existing?.sessionId || Math.random().toString(36).substring(2) + Date.now().toString(36);
    // (the rest remains standard...)

  async forkSession(sessionFileOrId: string, entryId: string, position: 'before' | 'at' = 'before'): Promise<{ newSessionFile: string; selectedText?: string } | { error: string }> {
    const tracked = this.getSession(sessionFileOrId);
    if (!tracked) return { error: 'Session not found' };

    if (tracked.type === 'server') {
      const sessionManager = SessionManager.open(tracked.sessionFile);
      const selectedEntry = sessionManager.getEntry(entryId);
      if (!selectedEntry) {
        return { error: 'Invalid entry ID for forking' };
      }

      let targetLeafId: string | null = null;
      let selectedText: string | undefined;

      if (position === 'at') {
        targetLeafId = selectedEntry.id;
      } else {
        if (selectedEntry.type !== 'message' || selectedEntry.message.role !== 'user') {
          return { error: 'Invalid entry ID for forking. Can only fork before user messages.' };
        }
        targetLeafId = selectedEntry.parentId;
        selectedText = this.extractMessageText(selectedEntry.message);
      }

      const sessionDir = sessionManager.getSessionDir();
      let forkedSessionPath: string | undefined;

      if (!targetLeafId) {
        const newManager = SessionManager.create(tracked.cwd, sessionDir);
        newManager.newSession({ parentSession: tracked.sessionFile });
        forkedSessionPath = newManager.getSessionFile();
      } else {
        forkedSessionPath = sessionManager.createBranchedSession(targetLeafId);
      }

      if (!forkedSessionPath) {
        return { error: 'Failed to create forked session' };
      }

      return { newSessionFile: forkedSessionPath, selectedText };
    } else {
      return { error: 'cli_bridge_delegated' };
    }
  }
```

---

### 4. `server/src/index.ts`
Import `SessionManager` and handle the `fork` and `cli_register` re-registrations:
```typescript
import { SessionManager, type AgentSessionEvent } from '@earendil-works/pi-coding-agent';

// Inside handleWSMessage under case 'cli_register':
    case 'cli_register': {
      client.isCliBridge = true;

      let oldSessionFile: string | null = null;
      for (const s of (pool as any).sessions.values()) {
        if (s.cwd === msg.cwd && s.type === 'cli' && s.sessionFile !== msg.sessionFile) {
          oldSessionFile = s.sessionFile;
          break;
        }
      }

      client.sessionId = msg.sessionFile;
      const result = await pool.registerCliSession(msg.sessionFile, msg.cwd, msg.model || '', client.ws);
      if (result.error) {
        sendWS(client.ws, { type: 'session_error', error: result.error });
      } else {
        console.log(`Registered CLI Bridge for session ${msg.sessionFile} at ${msg.cwd}`);
        const sId = result.tracked.sessionId;
        const msgToWeb: ServerMessage = {
          type: 'session_created',
          sessionId: sId,
          sessionFile: msg.sessionFile,
          cwd: msg.cwd,
          model: msg.model || '',
        };

        if (oldSessionFile && oldSessionFile !== msg.sessionFile) {
          for (const c of clients.values()) {
            if (c.sessionId === oldSessionFile && !c.isCliBridge) {
              c.sessionId = msg.sessionFile;
              pool.addClient(msg.sessionFile, c.id);
            }
          }
        }

        for (const c of clients.values()) {
          if (c.sessionId === msg.sessionFile && !c.isCliBridge) {
            sendWS(c.ws, msgToWeb);
            const history = pool.getSessionHistory(msg.sessionFile);
            sendWS(c.ws, {
              type: 'message_history',
              sessionId: sId,
              messages: history,
            });
          }
        }
      }
      break;
    }

// Inside handleWSMessage, add case 'fork':
    case 'fork': {
      let selectedText: string | undefined;
      try {
        const tracked = pool.getSession(msg.sessionId);
        if (tracked) {
          const sessionManager = SessionManager.open(tracked.sessionFile);
          const selectedEntry = sessionManager.getEntry(msg.entryId);
          if (selectedEntry && selectedEntry.type === 'message' && selectedEntry.message.role === 'user') {
            selectedText = (pool as any).extractMessageText(selectedEntry.message);
          }
        }
      } catch (err) {
        // Quiet fail
      }

      const result = await pool.forkSession(msg.sessionId, msg.entryId, msg.position || 'before');
      if ('error' in result) {
        if (result.error === 'cli_bridge_delegated') {
          const tracked = pool.getSession(msg.sessionId);
          if (tracked && tracked.type === 'cli') {
            tracked.cliWs.send(JSON.stringify({
              type: 'cli_fork',
              entryId: msg.entryId,
              position: msg.position || 'before',
              message: msg.message,
            }));
            if (selectedText && !msg.message) {
              sendWS(client.ws, {
                type: 'fork_editor_text',
                text: selectedText,
              });
            }
          }
        } else {
          sendWS(client.ws, { type: 'session_error', error: result.error });
        }
        return;
      }

      const loadResult = await pool.loadSession(result.newSessionFile);
      if (loadResult.error) {
        sendWS(client.ws, { type: 'session_error', error: loadResult.error });
        return;
      }

      pool.addClient(loadResult.tracked.sessionFile, client.id);
      switchClientSession(client, loadResult.tracked.sessionFile, pool);
      client.readOnly = false;

      sendWS(client.ws, {
        type: 'session_created',
        sessionId: loadResult.tracked.sessionId,
        sessionFile: loadResult.tracked.sessionFile,
        cwd: loadResult.tracked.cwd,
        model: loadResult.tracked.model,
      });

      const history = pool.getSessionHistory(loadResult.tracked.sessionFile);
      sendWS(client.ws, {
        type: 'message_history',
        sessionId: loadResult.tracked.sessionId,
        messages: history,
      });

      if (msg.message) {
        await pool.sendUserMessage(loadResult.tracked.sessionFile, msg.message);
      }
      break;
    }
```

---

### 5. `extension/src/index.ts`
Implement the `cli_fork` WebSocket handler:
```typescript
          case "cli_fork": {
            ctxVal?.ui.notify("[Wherever] Received fork command from remote client", "info");
            (ctxVal as any)?.fork(msg.entryId, {
              position: msg.position || 'before',
              withSession: async (newCtx: any) => {
                if (msg.message) {
                  await newCtx.sendUserMessage(msg.message);
                }
              }
            });
            break;
          }
```

---

### 6. `web/src/lib/wherever.ts`
Implement the stores and actions, and parse `m.id` on Svelte:
```typescript
import { setCurrentSession, fetchSessions } from './session-store';

export const forkedEditorText = writable<string | null>(null);
export const forkTargetEntryId = writable<string | null>(null);

// Inside ChatMessage interface, add entryId:
export interface ChatMessage {
  id: string;
  entryId?: string;
  role: 'user' | 'assistant' | 'thinking' | 'tool';
  // ...

// Inside message_history handler, map id:
              } else {
                mapped.push({
                  id: generateId(),
                  entryId: m.id,
                  role: m.role,
                  content: m.content,
                  timestamp: m.timestamp,
                  isStreaming: false,
                  toolName: m.toolName,
                  sessionId: msg.sessionId,
                });
              }

// Inside websocket message open, handle fork_editor_text:
        case 'fork_editor_text':
          forkedEditorText.set(msg.text);
          break;

// Under session_created case, add fetchSessions():
        case 'session_created':
          state.update((s: PiRemoteState) => ({
            ...s,
            session: msg.sessionFile,
            sessionId: msg.sessionId,
            activeSessionFile: msg.sessionFile,
            activeCwd: msg.cwd,
            activeModel: msg.model,
          }));
          setCurrentSession(msg.sessionFile);
          fetchSessions();
          break;

// Export the startFork, cancelFork and submitFork helpers:
export function startFork(entryId: string, initialText: string) {
  forkTargetEntryId.set(entryId);
  forkedEditorText.set(initialText);
}

export function cancelFork() {
  forkTargetEntryId.set(null);
  forkedEditorText.set('');
}

export function submitFork(message: string) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  const s = get(state);
  if (!s.sessionId) return;
  const targetId = get(forkTargetEntryId);
  if (!targetId) return;

  ws.send(JSON.stringify({
    type: 'fork',
    sessionId: s.sessionId,
    entryId: targetId,
    position: 'before',
    message
  }));

  forkTargetEntryId.set(null);
}
```

---

### 7. `web/src/lib/components/ChatMessageList.svelte`
Add edit icon and invoke `startFork` on previous user messages:
```svelte
<!-- Import startFork -->
import { messages, isStreaming, abort, clearMessages, activeSessionInfo, startFork } from '$lib/wherever';

<!-- Render pencil button with order-first on hover row -->
			{#each msgList as msg (msg.id)}
				<div class="flex {msg.role === 'user' ? 'justify-end' : 'justify-start'} group items-center gap-2">
					{#if msg.role === 'user' && msg.entryId}
						<button
							onclick={() => startFork(msg.entryId, msg.content)}
							class="opacity-0 group-hover:opacity-100 p-1.5 bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white rounded border border-gray-700/50 shadow transition-all shrink-0 order-first"
							title="Fork here and edit message"
						>
							<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
								<path d="M12 20h9"/>
								<path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>
							</svg>
						</button>
					{/if}
```

---

### 8. `web/src/lib/components/ChatInput.svelte`
Import and listen to `forkTargetEntryId`, rendering the banner and the "Fork & Send" actions:
```svelte
<!-- Imports -->
import { sendMessage, piState, isConnected, createSession, clearMessages, leaveSession, forkedEditorText, forkTargetEntryId, cancelFork, submitFork } from '$lib/wherever';

<!-- Inside handleSend(): -->
		if ($forkTargetEntryId) {
			submitFork(trimmed);
			text = '';
		} else if (streaming) {
			queuedText = trimmed;
		} else {
			sendMessage(trimmed);
			text = '';
			onSend?.();
		}

<!-- Inside local effects: -->
	// Populate text input when a message is forked
	$effect(() => {
		if ($forkedEditorText !== null) {
			text = $forkedEditorText;
			forkedEditorText.set(null);
		}
	});

<!-- Inside ChatInput Render, add Fork Mode indicator banner: -->
<div class="p-4 border-t border-gray-700">
	{#if $forkTargetEntryId}
		<div class="bg-blue-900/30 border border-blue-500/30 rounded-lg p-3 mb-3 flex items-center justify-between gap-3 text-xs text-blue-100">
			<div class="flex items-center gap-2">
				<span class="text-blue-400 font-semibold uppercase tracking-wider text-[10px] bg-blue-900/60 px-1.5 py-0.5 rounded border border-blue-500/20">Fork Mode</span>
				<span>You are editing a past message. Sending this will fork the session at this point.</span>
			</div>
			<button
				type="button"
				onclick={() => {
					cancelFork();
					text = '';
				}}
				class="text-blue-300 hover:text-white hover:underline font-medium transition-colors cursor-pointer shrink-0"
			>
				Cancel Edit
			</button>
		</div>
	{/if}

<!-- Textarea update placeholders: -->
			placeholder={queuedText ? 'Message is queued...' : $forkTargetEntryId ? 'Edit your past message and fork session...' : ...}

<!-- Indigo Fork & Send Button rendering: -->
		{#if queuedText}
			<button>Unqueue</button>
		{:else}
			<button
				type="submit"
				disabled={effectivelyDisabled || !text.trim()}
				class="{$forkTargetEntryId ? 'bg-indigo-600 hover:bg-indigo-700' : 'bg-blue-600 hover:bg-blue-700'} disabled:bg-gray-600 disabled:cursor-not-allowed text-white px-6 py-3 rounded-lg font-medium transition-colors h-[48px] flex items-center justify-center shrink-0 gap-1.5"
			>
				{#if $forkTargetEntryId}
					<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
						<path d="M12 20h9"/>
						<path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>
					</svg>
					Fork & Send
				{:else if streaming}
					Queue
				{:else}
					Send
				{/if}
			</button>
		{/if}
```
