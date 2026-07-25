---
title: Pluggable TTS providers (a cloud TTS provider, Cartesia, with cloned voices, alongside the built-in browser voice)
slug: pluggable-tts-providers
needsAnswers: false
---

> Launch snapshot (records intent at creation, NOT maintained). Current truth: `docs/adr/` (decisions) + the code; remaining work: the tasks sliced from this spec. (The technical-detail sections below are trimmed by `to-task` once the work is tasked.)

## Problem Statement

Conversation mode's spoken reply (User Story 8 of the `conversation-mode` spec) currently uses ONLY the browser's built-in `SpeechSynthesis` voice. On a phone that voice is often robotic and locale-limited, and there is no way to use a nicer, higher-quality, or PERSONAL voice. The user specifically wants to hook a cloud TTS provider (**Cartesia**), which supports **voice cloning** (a `voice_id` for a cloned voice), so the agent's spoken replies can be read in a chosen or personal voice instead of the stock browser voice.

## Solution

Make TTS **pluggable**: keep the built-in browser `SpeechSynthesis` voice as the default provider, and add a **cloud TTS provider (Cartesia)** the user can select. The `say` tool's short spoken text (already the single source of truth for what is spoken) is routed to whichever provider is configured. Cartesia reads it in the configured (optionally CLONED) voice.

This is coherent with what the codebase already does for the REVERSE direction: speech-to-TEXT already has a "Cloud AI" engine that proxies to server-side providers via `POST /session/transcribe`. A Cartesia TTS provider is the mirror-image (cloud text-to-SPEECH via a server proxy), so it reuses an established pattern rather than inventing one. The agent-facing surface is unchanged: `say` still just carries text over the existing `tool_start`/`tool_end` stream; only the CLIENT's playback of that text becomes provider-configurable.

## User Stories

1. As a user, I want to CHOOSE which TTS voice reads the agent's spoken replies (the built-in browser voice, or a cloud provider like Cartesia), so that I am not stuck with the robotic stock voice on my phone.
2. As a user, I want a **Cartesia** cloud TTS provider option, so that spoken replies use Cartesia's higher-quality voices.
3. As a user, I want to use a **cloned / chosen voice** with Cartesia (via a `voiceId`), so that the agent speaks in a voice I picked or created.
4. As a user, I want the **built-in browser voice to remain the default**, so that nothing changes and no setup is needed unless I opt into a cloud provider.
5. As a user, I want my TTS provider + voice choice to **persist** (in the existing conversation-mode knobs / config), so that it survives reloads and session switches.
6. As a user, when I have SELECTED Cartesia and it fails (no server, no key, offline, API error), I want a **clear one-time error** surfaced (not a silent swap to the browser voice), so that I know my chosen cloud voice did not work and can fix it (an explicit selection deserves an explicit failure, not a silent substitute). (The built-in browser voice is only used when it is the SELECTED provider, or as the untouched default; a Cartesia failure does NOT silently fall back to it.)
7. As a maintainer, I want the **Cartesia API key held server-side** (a `POST /session/tts` proxy behind the existing token gate, mirroring `/session/transcribe`), so that the key is never exposed in the phone browser / PWA client. (Pending Open Question 1.)
8. As a maintainer, I want TTS routed through a **single provider seam** (the existing `core/speak.ts` TTS module), so that adding Cartesia (and future providers) is a clean addition, not a rewrite of the call sites that already speak the `say` text.
9. As a user on mobile, I want the cloud-TTS audio playback to **work on my phone / PWA** (respecting mobile autoplay/gesture rules), so that selecting Cartesia does not reintroduce the "nothing plays on mobile" problem. (Shares the `mobile-tts-gesture-unlock` gesture-unlock, extended to prime the cloud-audio `<audio>` element too.)
10. As a user, I want conversation mode's `speakReplies` knob to keep gating ALL spoken output regardless of provider, so that turning spoken replies off silences the cloud voice too.
11. As a user, before I first send my agent's spoken replies to a THIRD-PARTY cloud service (Cartesia), I want a one-time **acknowledgement** that selecting a cloud provider sends the `say` text off-device (and may incur cost), so that the third-party data flow is a conscious, acknowledged opt-in rather than a silent side-effect of picking a voice.
12. As a maintainer, I want the provider seam designed so a future **streaming** Cartesia variant slots in WITHOUT rewriting the `say` call sites or the settle signal. v1 ships one-shot (whole-blob) playback, but the seam consumes a PLAYBACK HANDLE (abstracting "audio that plays and eventually finishes"), so streaming (chunked audio behind the same handle) is a later addition, not a redesign.

### Autonomy notes (the two gate axes)

- **`humanOnly`:** omitted (ordinary product/UX work). BUT NOTE: the SERVER-side key handling (a `/session/tts` proxy holding a Cartesia API key) is secrets-adjacent; the TASK that wires the key/proxy may warrant `humanOnly` at tasking time (decided per task from its own build-nature, not inherited here).
- **`needsAnswers: false`:** the five launch open questions are RESOLVED (see "Resolved decisions" below). They shaped the task boundaries (a server-proxy task exists; the knob set is `ttsProvider` + `voiceId`; playback is a streaming-ready handle; failure ERRORS rather than silently falling back; a third-party acknowledgement gate is required).

## Resolved decisions (the five launch open questions)

1. **Key location = SERVER-SIDE.** A `POST /session/tts` proxy behind the existing token gate holds the Cartesia key, exactly mirroring the `/session/transcribe` cloud-STT proxy. The key is NEVER sent to the client. (So Cartesia TTS requires a connected Wherever server; a keyless/serverless client cannot use it.)
2. **Knobs = `ttsProvider` + free-text `voiceId`; server holds a DEFAULT voice.** `ttsProvider` (`browser` | `cartesia`) and a free-text `voiceId` live in the conversation-mode knobs registry (the established persistence pattern). `voiceId` is a Cartesia voice/clone id the user pastes; when BLANK, the server proxy uses a DEFAULT voice id configured server-side (alongside the key). Voice LISTING is out of scope (a follow-up).
3. **v1 = one-shot blob, but the seam is STREAMING-READY.** v1 POSTs the `say` text and plays the whole returned audio blob. Critically, the `speak()` seam is designed around a PLAYBACK HANDLE abstraction ("audio that plays and eventually settles"), NOT a hardcoded `<audio src=blob>`: one-shot is "the whole blob arrives at once" and a future streaming variant is "chunks arrive over time" behind the SAME handle, so streaming slots in without rewriting the `say` call sites or the TTS-settle signal. The streaming Cartesia variant is a SEPARATE follow-on spec; this spec only guarantees the seam does not preclude it.
4. **Failure ERRORS, it does NOT silently fall back.** When Cartesia is the SELECTED provider and a request fails (no server / no key / offline / API error), surface a clear ONE-TIME error (in the `say` card / a toast) and go silent for that reply, and do NOT silently swap to the browser voice. An explicit provider selection deserves an explicit failure. The browser voice is used only when it is the selected provider (and remains the untouched default for users who never opt in).
5. **A one-time third-party acknowledgement gates first cloud use.** Selecting Cartesia is opt-in, but the FIRST time cloud TTS would send the `say` text off-device, require a one-time acknowledgement that the text goes to a third party (Cartesia) and may incur cost. Persist the acknowledgement so it is asked once. No per-call gate and no extra length cap beyond `say` already being short.

## Implementation Decisions

> Seed for tasking; trimmed once tasked.

- **Provider seam (streaming-ready).** Generalise `core/speak.ts` from a single `speakUtterance` into a provider-dispatched `speak(text, { lang, provider, voiceId })` returning a PLAYBACK HANDLE the TTS-settle signal keys off (so `whenTtsIdle`/`isTtsSpeaking` work identically for the browser utterance, a one-shot cloud blob, and a future streamed cloud audio). The browser `SpeechSynthesis` path (today's code) is the default provider; the Cartesia path is additive. The `say`-driven call site is unchanged except that it reads the configured provider/voice.
- **Cartesia cloud path.** Client POSTs the short `say` text (+ `voiceId`, optional model/format) to `POST /session/tts` (token-gated, mirroring `/session/transcribe`); the server holds the Cartesia key + a default `voiceId`, calls Cartesia, and returns audio (one-shot blob for v1, designed so a streamed response can be added later). The client plays it through the playback handle, sharing (and extending) the `mobile-tts-gesture-unlock` gesture-unlock so the `<audio>` element is primed on mobile.
- **Knobs.** Add `ttsProvider` (`browser` | `cartesia`) and `voiceId` to the conversation-mode knobs registry, persisted in the established pattern; `speakReplies` still gates ALL output regardless of provider. A persisted `cloudTtsAcknowledged` flag records the one-time third-party acknowledgement.
- **Failure = error, not fallback.** A selected-Cartesia failure surfaces a one-time error and goes silent for that reply; it does NOT swap to the browser voice.

## Testing Decisions

> Seed for tasking; trimmed once tasked.

- **Provider seam:** unit: `speak(...)` dispatches to the browser path by default and to the Cartesia path when selected; `speakReplies` off => nothing speaks regardless of provider; the returned PLAYBACK HANDLE drives the TTS-settle signal identically for the browser utterance and a cloud blob (so the hands-free loop is provider-agnostic); a selected-Cartesia FAILURE surfaces a one-time error and goes silent (it does NOT speak via the browser voice).
- **Server proxy:** the `/session/tts` route is token-gated like the other `/session/*` routes; a blank client `voiceId` uses the server default voice; a missing key / upstream error returns a clean error the client surfaces (not a fallback); the Cartesia key is read from server config and NEVER sent to the client.
- **Acknowledgement gate:** the first cloud-TTS send requires the one-time acknowledgement; once acknowledged (persisted) it is not asked again; declining leaves the reply un-spoken (no third-party send).
- **Mobile playback:** the cloud-audio playback handle respects the gesture-unlock so it plays on mobile after the user opts in.
- **Shared-write isolation:** any server config read for the key/default-voice is tested against a temp/scratch config, asserting the real one is untouched.

## Out of Scope

- **Replacing the built-in browser voice.** The browser `SpeechSynthesis` voice stays the default; Cartesia is additive/opt-in. (Note: a Cartesia FAILURE errors rather than silently falling back to the browser voice; see Resolved decision 4.)
- **Streaming cloud TTS.** v1 is one-shot (whole-blob) playback. The streaming Cartesia variant is a SEPARATE follow-on spec; this spec only guarantees the playback-handle seam does not preclude it (Resolved decision 3).
- **Voice cloning / voice creation itself.** The user creates/obtains their cloned voice in Cartesia's own dashboard and pastes its `voiceId` (or leaves it blank to use the server default); we do not build a cloning UI. Voice LISTING from the server proxy is a possible follow-up, not v1.
- **Changing the agent-facing `say` tool.** `say` still just carries text over the existing stream; no new WS message type, no new chat role; only the client's playback becomes provider-configurable.
- **Other providers.** The seam is designed to allow more providers later, but v1 ships exactly browser + Cartesia.
- **STT / the transcribe path.** This spec is TTS (text→speech) only; the existing `/session/transcribe` STT path is reused as a PATTERN, not modified.

## Further Notes

- Reuse, do not reinvent: `core/speak.ts` (the single TTS seam), the conversation-mode knobs registry (`core/conversation-mode.ts` + `wherever.ts` persistence), the `POST /session/transcribe` server proxy + SpeechButton "Cloud AI" engine (the mirror-image cloud pattern), and the `mobile-tts-gesture-unlock` fix (the mobile playback unlock).
- Depends on `mobile-tts-gesture-unlock` landing (the cloud-audio mobile playback extends that gesture-unlock); record as `blockedBy` / `taskedAfter` at tasking time.
- A STREAMING Cartesia variant is a deliberate follow-on spec; this spec's playback-handle seam (Resolved decision 3) is what keeps that follow-on from being a rewrite. Capture it as a `work/notes/ideas/` item or a proposed spec when this lands.
- Changeset rule (`AGENTS.md`): `web/` + `server/` changes → `"wherever-dev": <bump>`. No `extension/` change expected (the `say` tool is unchanged). Never bump `@wherever-dev/web`.
