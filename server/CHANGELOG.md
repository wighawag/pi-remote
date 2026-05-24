# pi-remote-server

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
