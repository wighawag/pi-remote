# pi-remote-server

## 0.0.3

### Patch Changes

- e54e697: Allow users to collapse folders in the session browser even when a filter query is active, with automatic reset of search-specific folder expansions when clearing the search query.
- 948ad33: fix: show full folder path under folder name in session sidebar

  When multiple directories share the same basename (e.g. `/home/user/wighawag`
  and `/home/user/projects/wighawag`), they appeared as separate groups with the
  same visible name, making them indistinguishable. Now the full resolved path is
  shown in smaller gray text beneath the folder name for easy differentiation.

- 14f1269: Show queued message text in input box as greyed-out italic text when agent is streaming

  When a message is queued (sent while agent is working), the text is now visible in the disabled textarea in a grey italic style instead of being hidden. Unqueueing clears the text and re-enables editing. Also added a refresh button (↻) next to the session filter in the sidebar to manually refresh the session list, with a spinning animation while loading.

- d319cfd: Fixed session list issues in the sidebar:
  - Fixed duplicate folder entries by properly resolving path representations (like expanding ~ and relative paths) consistently on the server.
  - Added keyed loops in Svelte `#each` blocks to make session list rendering reactive and prevent unnecessary DOM rebuilds.
  - Debounced `fetchSessions()` calls to coalesce rapid concurrent requests during bulk operations.
  - Added a "Delete All" button inside each folder's expanded session list to delete all sessions of that folder at once.
  - Prevented visual reloading/layout-flashing by keeping the existing list visible during background refreshes, only displaying the loading spinner on initial load when the folder list is empty.

- a697a2d: Ensure model choices are preserved across page reloads, server restarts, and synchronized dynamically between web and CLI.

  Specifically:
  - Fixed an issue where the model resolved to the first (oldest) model_change entry on session reload/restart instead of the most recent one.
  - Added model_select event propagation so that changing the model in a CLI session dynamically updates any connected web client.
  - Added support in the CLI bridge extension to receive and apply model changes initiated from the remote web dashboard.

## 0.0.2

### Patch Changes

- 2b2a81e: Add the ability to send images and documents by uploading them to a configurable server-side folder and appending their absolute paths to the user's message so the agent can read and process them.
- dda50b5: Add hint on the main screen stating that the sidebar can be used to open existing/running sessions.
  - format files

- 4859ae8: remove empty message from the conversation
- 1ae3216: Compress session list folders by default and support inline session deletion with double-confirmation, syncing state instantly across all clients. Fix mobile browser layout issues on Firefox by locking page overscroll and constraining container layout to visual viewport boundaries.
- 696abee: auto-completion path
- 66f8354: common folder
- e890743: Add support for executing bash commands directly from the Svelte web frontend using the `!` prefix (e.g., `!ls`, `!!git status`), matching the pi CLI's interactive behavior.
  - Intercepts prompts starting with `!` or `!!` on the server and runs them through the active AgentSession's executeBash or forwards them as `cli_bash` messages to the CLI bridge client.
  - Streams tool execution chunk updates back to the Svelte client in real-time.
  - Captures output and exit status and persists them to the session log as a `bashExecution` history message.
  - Supports raw output streaming of direct shell command executions.

- ce9aff8: Document all advanced features in the main README and enrich the USAEG guide with HTTP endpoints and WebSocket events.
- 002e622: fix abort on reload
- 49bc222: better side bar
- bf81616: git remote repo creation
- 2a1466a: speech api
- b8acc26: Improve speech recording feedback and reliability:
  - Transition from `MediaRecorder` to direct `AudioContext` / PCM buffer capture for instant, zero-latency WAV creation.
  - Add an audible synthesizer beep / chime on recording start for clear user feedback.
  - Introduce an explicit `isProcessing` state during local downsampling and cloud transcription to replace the red pulsing mic indicator with an orange processing indicator.
- 0a6f84e: remove empty message from the conversation and fix url hash persistence
- 99c1afa: Remove the clear button from the chat list and add a way to collapse the text input bar for easier reading on mobile. Clicking the collapsed bar expands the input and automatically focuses the textarea.
- ba41c2a: better enter keys for send
- 5ba8fd3: add option to upload via normal post request

## 0.0.1

### Patch Changes

- first release
