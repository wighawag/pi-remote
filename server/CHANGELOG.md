# wherever-dev

## 0.3.0

### Minor Changes

- a0a6adc: Reuse the chat composer as the search composer instead of a separate top-bar input.

  ChatInput is now mode-aware via props (onSubmit, placeholder, submitLabel, showAttach, searchMode, searchConfigured). In search mode it routes submit to the injected handler (runSearch), is enabled with no active session (requires only a live connection and a configured search folder), shows the "Search the web..." placeholder and "Search" button, hides file attach, and skips slash-command handling. The mic, autosize, and Shift+Enter behaviour are kept in both modes.

  On the page the inline single-line top-bar search input is removed. The always-mounted bottom composer becomes the search composer in the empty state (connected, search folder configured, no active session), which is also the page-load state, so users can type directly. When a session is active, a compact magnifier button in the top bar drops back to the search empty state and focuses the composer synchronously inside the tap gesture so the mobile virtual keyboard rises (notably on iOS Safari). Only one search input is ever shown at a time.

  Also fixes a bug where a search query was silently dropped: the client runs app message listeners before its internal state update, so sending the pending query directly from the session_created handler hit sendMessage while sessionId was still null. The query is now deferred to a microtask so the session is fully established first, and the magnifier clears the URL hash synchronously to avoid flashing the "Loading session..." spinner.

- 242b652: Add a web "search mode". A search bar in the dashboard top bar (visible when connected and a search folder is configured, autofocused on first load) creates a fresh session in the configured search folder and sends the query as the first message, returning a current, cited answer. New `searchFolder` and `searchCreateRemote` config keys (in `~/.wherever/config.json`) are exposed via `GET /config`; the search folder is created on demand on first search, with a private remote when `searchCreateRemote` is enabled and a matching remote rule exists. The reusable web-search skill (in `skills/web-search`) drives the same behaviour from the terminal via the companion `pisearch` installer.

### Patch Changes

- 37de34b: Extract core client WebSocket and state management logic into a dedicated, framework-agnostic `@wherever-dev/client` monorepo package. Update both the web dashboard (`@wherever-dev/web`) and the CLI extension (`@wherever-dev/pi`) to use the new shared client, reducing duplicate code and establishing a modular architecture for future integrations.
- ffd28c7: Improve resume behaviour after the page is backgrounded (notably Firefox on Android after a screen lock). The dashboard now closes its WebSocket after the page has been hidden for a short delay and reconnects immediately on return, improving back/forward-cache eligibility (so resume can be instant) and ensuring that, when a full reload does happen, the active session is restored quickly from the URL hash. Quick tab switches do not churn the connection.
- ffd28c7: Fix stale data on first load: the service worker no longer serves cached responses for dynamic server API endpoints (`/sessions`, `/config`, `/models`, `/check-path`, `/autocomplete-path`, `/session/*`, `/health`), which are now fetched online-first. App-shell navigations are also served online-first so a freshly deployed build is picked up without needing a second reload. Hashed assets and images remain cache-first for offline support.
- ffd28c7: Fix: unqueuing a queued message now restores its text into the editable input (so it can be edited or resent) instead of silently discarding it. Previously `Unqueue` cleared the input even though a backup of the message existed.
- 40c88c7: robust againt invalid session file
- ee52ff4: Improve Lighthouse scores for the dashboard PWA.
  - Web: stop shipping un-minified production assets. The Vite build had an
    inherited `minify: false` override which left JS/CSS unminified, roughly
    halving the largest chunk's size and fixing slow First/Largest Contentful
    Paint. Sourcemaps stay enabled for debuggable production stack traces.
  - Server: set `Cache-Control` headers when serving static files. Content-hashed
    `/_app/immutable/` assets are served `public, max-age=31536000, immutable`;
    the HTML app shell, manifest and other top-level files stay `no-cache` so a
    freshly deployed build is always picked up. This fixes the "efficient cache
    lifetimes" audit without affecting the service worker's own caching.
  - Server: add `.txt` and `.webmanifest` MIME types so robots.txt is served as
    `text/plain` and the manifest as `application/manifest+json` instead of
    `application/octet-stream`.
  - Web: add a minimal valid `robots.txt` so the SPA fallback no longer returns
    the HTML app shell for `/robots.txt` (which Lighthouse flagged as invalid).
    Wherever is a private Tailscale-only tool, so it disallows all crawlers.

- affc7cf: PWA: make the installed icon resolve correctly on Firefox Android. Regular icons now carry an explicit `purpose: "any"` (some Firefox versions otherwise fall back to a generated letter icon), and maskable icons are generated at both 192 and 512 (Firefox prefers a maskable at the launcher size). Firefox still overlays its own small badge on installed-PWA icons, which is a browser behaviour and not controllable from the manifest.
- eb0cfd0: PWA polish: the installed app icon is now generated from the Wherever logo (`logo.svg`) instead of the old placeholder, a properly padded `maskable` icon is generated (fixing the previous broken/missing maskable icon reference), and the manifest now declares desktop (`wide`) and mobile screenshots so Chrome offers its richer install UI. Icon/screenshot assets are produced at build time via a post-process step from committed sources under `static/pwa-src/`.
- 7b2ca04: PWA: set the web manifest `display` to `standalone` (was the pwag default `fullscreen`) and give the app a real identity (`name`/`title` "Wherever" with a proper description) instead of the template placeholder. This makes the installed app launch in its own window rather than a normal browser tab on browsers that honor `standalone`.
- 347e214: Removed all architecture overview diagrams and explicit references to "pi CLI" from the website landing page to simplify the landing page experience and remove any installation dependencies on pi or the CLI extension for typical dashboard users.
- a57e137: Rephrased website landing page copy, app description, and user onboarding elements to focus on building and maintaining apps "from wherever" (on any device), shifting the AI component to an implementation detail and correcting references from "mirroring terminal" to "syncing sessions and conversations".
- ffd28c7: Speed up loading of long sessions with tail-first history windowing. On load/join, the server now sends only the most recent messages (with a total count and offset) instead of the entire history in one payload, and the web dashboard shows a "Load older messages" button that lazily fetches earlier windows (with scroll-position anchoring). This adds `history_load_more` / `message_history_prepend` to the protocol and a `loadMoreHistory()` method plus history pagination state to `@wherever-dev/client`.
- fd8427d: Updated documentation and the landing page to clarify that installing the `pi` CLI is optional and not required to run Wherever in Headless Mode. Added notes detailing the architectural limitation where quitting/killing the `pi` CLI in Bridge Mode interrupts active sessions and running tools.

## 0.1.0

### Minor Changes

- 76522ac: Add standalone marketing/info website for GitHub Pages deployment. The new `site/` folder contains a SvelteKit + TailwindCSS static site with a landing page featuring hero section, features grid, architecture diagram, install guide, and footer. Includes a custom SVG logo with a pi symbol made of tetris-like blocks and signal waves. Deployed automatically via GitHub Actions workflow on push to main.

### Patch Changes

- bb36b59: Automatically expand shell/bash command tool calls in the remote web dashboard when the user executes a prompt starting with "!" or "!!".
- 8626cd3: Automatically update the session browser list in the sidebar in real time whenever a session is created, loaded, left, when client connections open or close, and when messages or agent cycles end.
- 26cba7b: Add toggles for hiding tool calls and thinking messages in the chat UI.
- e5fae9d: Maximize available horizontal space in the header for the workspace folder path by displaying the agent status (Ready vs. Agent working) directly on the robot model selector icon, removing the redundant text status indicators.
- e87ab30: Add "Hide thinking steps" and "Hide tool calls" options in the config UI to clean up the chat log. "Hide tool calls" keeps tool execution blocks visible if they are associated with explicit user terminal commands starting with `!` or `!!`.
- bb0bc3d: Normalize `cwd` paths in the server's session pool before creating, loading, or registering sessions. This resolves duplicate session folders when a workspace is accessed with vs. without a trailing slash (e.g. `--home-wighawag...--` vs `--home-wighawag...---`), fragments conversation history, and handles relative segments and double slashes.
- 01e6641: Fix the `/new` / `session_new` command on the server so that it successfully creates a brand new, clean session instead of returning the existing active session when the requesting client is already connected to it.
- 0630cff: Add a full-screen loading overlay on the main screen during session creation. This prevents users from initiating multiple simultaneous session creations and provides visual feedback during the creation delay.
- afe5ebc: Change sessions in the sidebar session browser to standard anchor links, allowing users to middle-click, command-click, or right-click to open sessions in new tabs.
- 70a974a: Configure both `web` and `site` packages for static site pre-rendering by setting `prerender = true` (in page/layout routing) and removing `fallback: 'index.html'` from the svelte static adapter configs. This enables SvelteKit to generate correct, portable relative-path references in the built HTML files, allowing the dashboard and marketing website to load perfectly under subpaths or IPFS gateways.
- ae04a3c: Redesign the remote web dashboard to match the brand design system and colors of the marketing website, introducing brand-dark, brand-surface, brand-border, emerald, and rose theme tokens across all UI components, dialogs, inputs, and layout blocks.

## 0.0.4

### Patch Changes

- 393e8aa: update to port 31415

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
