# Plan: Ideas Vault Integration with Pi-Remote

This document specifies the step-by-step implementation details for integrating the centralized **Ideas Vault** (`/home/wighawag/dev/github/wighawag/ideas`) directly into the `pi-remote` web interface and server backend. 

An agent can follow this document to implement the capture button, speech-to-text dictation modal, and the local file-protocol saving mechanism.

---

## 1. Feature Specifications

1. **💡 Quick Capture Button**: A lightbulb button in the dashboard header or sidebar, plus a keyboard shortcut (`Alt+I` or `Cmd+Shift+I`) to open the Idea Capture Modal.
2. **🎯 Context-Aware Project Mapping**:
   - The modal automatically reads the active Svelte store `$activeSessionInfo` to extract the `cwd` (Current Working Directory) of the active agent session.
   - It extracts the base directory name (e.g., `/home/wighawag/dev/github/wighawag/pi-remote` ➔ `pi-remote`) and sets it as the default target project.
3. **🎙️ Voice Dictation Integration**: Reuses Svelte's existing `SpeechButton.svelte` component, enabling the user to dictate their idea out loud, stream it to the backend transcription service, and populate the description field automatically.
4. **💾 Direct Local Save**: The server writes the idea to the correct folder inside the ideas repository in the standard YAML frontmatter + Markdown schema.

---

## 2. Technical Architecture

```text
+-------------------------------------------------------------+
|                     pi-remote Web UI                        |
|  [Click 💡]  --> Opens <IdeaCaptureModal>                   |
|  - Title: Input                                             |
|  - Project: Select (Default: activeSessionInfo.cwd)         |
|  - Tags: Comma-separated Input                              |
|  - Description: Textarea + <SpeechButton> for Voice mic     |
|                                                             |
|  [Submit] --> POST /session/save-idea                       |
+----------------------------------------+--------------------+
                                         |
                                         | Fetch HTTP POST
                                         v
+-------------------------------------------------------------+
|                   pi-remote Node.js Server                  |
|  - Endpoint: /session/save-idea                             |
|  - Resolves IDEAS_REPO_PATH (Env or fallback)               |
|  - Formats content to match templates/idea-template.md      |
|  - Slugifies title to generate clean filename               |
|  - Writes to:                                               |
|    - general/<slug>.md (if non-grouped)                     |
|    - projects/<project-slug>/<slug>.md (if grouped)         |
+----------------------------------------+--------------------+
                                         |
                                         | Writes directly
                                         v
+-------------------------------------------------------------+
|                      Local Ideas Vault                      |
|                  ~/dev/github/wighawag/ideas                |
+-------------------------------------------------------------+
```

---

## 3. Step-by-Step Implementation Guide

### Phase 1: Backend Route (`server/src/index.ts`)

Create a new POST handler in the main request handler of `server/src/index.ts` right next to the `/session/transcribe` route.

1. **Route Matching**:
   ```typescript
   if (pathname === '/session/save-idea' && req.method === 'POST') {
     // Implement handler...
   }
   ```
2. **Environment & Paths**:
   - Retrieve the vault root path:
     ```typescript
     const ideasRepoPath = process.env.IDEAS_REPO_PATH || '/home/wighawag/dev/github/wighawag/ideas';
     ```
3. **Payload Processing**:
   - Read and parse the JSON payload containing:
     - `title`: string
     - `project`: string (e.g. `'pi-remote'` or `'general'`)
     - `tags`: string[]
     - `text`: string (description of the idea)
     - `createdBy`: `'user'` | `'voice'` (flag indicating if voice recording was used)
4. **Slugification & File Layout**:
   - Slugify the title (lowercase, replace non-alphanumeric with hyphens).
   - Resolve target directory:
     - If `project === 'general'`: `path.join(ideasRepoPath, 'general')`
     - Otherwise: `path.join(ideasRepoPath, 'projects', projectSlug)`
   - Create the directory recursively: `fs.mkdirSync(dir, { recursive: true })`.
5. **Template Assembly**:
   Assemble the exact markdown template matching the ideas store spec:
   ```typescript
   const dateStr = new Date().toISOString().replace('T', ' ').slice(0, 19);
   const formattedTags = tags.map(t => t.trim().toLowerCase()).filter(Boolean);
   
   const fileContent = `---
   title: "${title.replace(/"/g, '\\"')}"
   date: ${dateStr}
   project: "${project}"
   status: "backlog"
   tags: [${formattedTags.join(', ')}]
   created_by: "${createdBy}"
   ---
   
   # ${title}
   
   ## 💡 The Core Concept
   ${text.trim().split('\n')[0] || 'No core concept provided.'}
   
   ## 🎯 Context & Problem
   ${text.trim()}
   
   ## 🛠️ Implementation & Technical Thoughts
   - Captured via pi-remote client.
   `;
   ```
6. **Save to Disk**:
   - Write file using `fs.writeFileSync(path.join(dir, `${slug}.md`), fileContent, 'utf-8')`.
   - Return `{ success: true, savedPath: filePath }`.

---

### Phase 2: Frontend Capture Modal (`web/src/lib/components/ideas/`)

Create a new file `web/src/lib/components/ideas/IdeaCaptureModal.svelte` using Svelte 5 runes:

```html
<script lang="ts">
	import SpeechButton from '../speech/SpeechButton.svelte';
	import { activeSessionInfo } from '$lib/pi-remote';
	import { getBaseUrl } from '$lib/session-store';

	let { isOpen = $bindable(), onClose }: { isOpen: boolean; onClose: () => void } = $props();

	// State
	let title = $state('');
	let tags = $state('');
	let description = $state('');
	let isVoiceUsed = $state(false);
	let isSubmitting = $state(false);
	let errorMsg = $state<string | null>(null);

	// Deduce default project based on active session's CWD
	let activeCwd = $derived($activeSessionInfo?.cwd || '');
	let defaultProject = $derived(
		activeCwd ? activeCwd.split('/').pop() || 'general' : 'general'
	);
	let project = $state('');

	$effect(() => {
		if (isOpen) {
			project = defaultProject;
			title = '';
			tags = '';
			description = '';
			isVoiceUsed = false;
			errorMsg = null;
		}
	});

	// Trigger voice-used flag when SpeechButton writes text
	$effect(() => {
		if (description.length > 0) {
			// Basic detection if SpeechButton was used
			isVoiceUsed = true;
		}
	});

	async function handleSubmit() {
		if (!title.trim() || !description.trim()) {
			errorMsg = 'Title and Description are required.';
			return;
		}

		isSubmitting = true;
		errorMsg = null;

		try {
			const baseUrl = getBaseUrl();
			const payload = {
				title: title.trim(),
				project: project.trim() || 'general',
				tags: tags.split(',').map(t => t.trim()).filter(Boolean),
				text: description.trim(),
				createdBy: isVoiceUsed ? 'voice' : 'user'
			};

			const res = await fetch(`${baseUrl}/session/save-idea`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(payload)
			});

			const data = await res.json();
			if (!res.ok) throw new Error(data.error || 'Failed to save idea');

			isOpen = false;
			onClose();
		} catch (err: any) {
			errorMsg = err.message || 'An error occurred while saving the idea';
		} finally {
			isSubmitting = false;
		}
	}
</script>

{#if isOpen}
	<div class="fixed inset-0 z-50 flex items-center justify-center p-4">
		<!-- Backdrop -->
		<div class="fixed inset-0 bg-black/60 backdrop-blur-sm" onclick={() => isOpen = false}></div>

		<!-- Dialog Panel -->
		<div class="relative z-10 w-full max-w-lg rounded-xl border border-brand-border bg-brand-surface p-6 shadow-2xl text-brand-text">
			<h2 class="text-xl font-bold mb-4 flex items-center gap-2 text-brand-cyan">
				💡 Capture New Idea
			</h2>

			{#if errorMsg}
				<div class="mb-4 rounded border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-400">
					{errorMsg}
				</div>
			{/if}

			<div class="space-y-4 text-sm">
				<!-- Title -->
				<div>
					<label class="block font-medium text-brand-text-muted mb-1">Title</label>
					<input type="text" bind:value={title} placeholder="e.g., Show Fork Parenting" class="w-full rounded border border-brand-border bg-brand-dark px-3 py-2 focus:border-brand-cyan focus:outline-none" />
				</div>

				<!-- Project & Tags Grid -->
				<div class="grid grid-cols-2 gap-4">
					<div>
						<label class="block font-medium text-brand-text-muted mb-1">Project Slug</label>
						<input type="text" bind:value={project} placeholder="e.g., pi-remote, general" class="w-full rounded border border-brand-border bg-brand-dark px-3 py-2 focus:border-brand-cyan focus:outline-none" />
					</div>
					<div>
						<label class="block font-medium text-brand-text-muted mb-1">Tags (comma-separated)</label>
						<input type="text" bind:value={tags} placeholder="ui, voice, feature" class="w-full rounded border border-brand-border bg-brand-dark px-3 py-2 focus:border-brand-cyan focus:outline-none" />
					</div>
				</div>

				<!-- Description / Speech Area -->
				<div>
					<label class="block font-medium text-brand-text-muted mb-1">Idea Description</label>
					<div class="relative flex items-start gap-2">
						<textarea bind:value={description} rows="4" placeholder="Detail your idea here... Click the microphone on the right to dictate." class="w-full rounded border border-brand-border bg-brand-dark px-3 py-2 focus:border-brand-cyan focus:outline-none resize-none"></textarea>
						<!-- Embedded Speech Dictation Button -->
						<div class="mt-1">
							<SpeechButton bind:text={description} disabled={isSubmitting} />
						</div>
					</div>
				</div>
			</div>

			<!-- Footer Buttons -->
			<div class="flex justify-end gap-3 mt-6 border-t border-brand-border pt-4">
				<button type="button" onclick={() => isOpen = false} class="px-4 py-2 rounded border border-brand-border hover:bg-brand-surface-2 transition-colors">
					Cancel
				</button>
				<button type="button" onclick={handleSubmit} disabled={isSubmitting} class="px-4 py-2 rounded bg-brand-cyan hover:bg-brand-cyan/80 text-black font-semibold transition-colors disabled:opacity-50">
					{isSubmitting ? 'Saving...' : 'Save Idea'}
				</button>
			</div>
		</div>
	</div>
{/if}
```

---

### Phase 3: Trigger Button & Keybindings

1. **Dashboard UI**:
   - Locate the main page interface in `web/src/routes/+page.svelte` (or header/sidebar files).
   - Inject a simple circular trigger button containing a lightbulb icon:
     ```html
     <button 
       onclick={() => showIdeaModal = true} 
       class="p-2.5 rounded-lg border border-brand-border bg-brand-surface hover:text-brand-cyan transition-colors"
       title="Quick Capture Idea"
     >
       💡
     </button>
     ```
   - Place `<IdeaCaptureModal bind:isOpen={showIdeaModal} onClose={() => { /* Show notification toast */ }} />` in the page body.
2. **Keybindings Listener**:
   - In `+page.svelte`'s `onMount` or an `$effect` block, register a hotkey:
     ```typescript
     const handleKeyDown = (e: KeyboardEvent) => {
       if ((e.altKey && e.key === 'i') || (e.metaKey && e.shiftKey && e.key === 'i')) {
         e.preventDefault();
         showIdeaModal = true;
       }
     };
     window.addEventListener('keydown', handleKeyDown);
     return () => window.removeEventListener('keydown', handleKeyDown);
     ```

---

## 4. Verification & Testing Checklist

- [ ] Execute `pnpm dev` inside `pi-remote` to start both local server and SvelteKit web client.
- [ ] Ensure `IDEAS_REPO_PATH` environment variable is exported or falls back to `/home/wighawag/dev/github/wighawag/ideas`.
- [ ] Open web dashboard, select an active session, and click the 💡 button.
- [ ] Verify the "Project Slug" field automatically populates with the active session's directory name.
- [ ] Type a title and tags, then click the mic icon. Dictate a sentence, stop recording, and ensure transcription streams correctly into Svelte's description text box.
- [ ] Click **Save Idea**.
- [ ] Navigate to the `ideas` repository folder and verify that the file has been successfully created with correct YAML Frontmatter and Markdown headers!
