# Voice + a conversational ("discuss") session mode for wherever

## Context

wherever already has **WAV dictation + STT** (browser Web Speech API, or server-side cloud Whisper / GLM-ASR): push-to-talk, transcribe-to-text, drop the text into the input. That is *dictation*, NOT *live conversation*. A separate effort builds a genuine **live-conversation cascade** (real-time STT -> LLM/Pi -> TTS over WebRTC, snappy, cloned voice) in the **my-boxes** repo (../my-boxes, box-01.ska.sh). This idea brings live voice INTO wherever, and exploring it surfaced TWO layered realizations: (1) there is a session **interaction mode** distinction that is bigger than voice, and (2) voice plays at least two distinct **roles**. Explore all of it; wherever likely wants several.

## The bigger distinction: agentic mode vs a conversational ("discuss") mode

wherever today runs the **normal agentic workflow**: Pi plans, calls tools, edits, does real work; turns can be long. But there is a second, distinct interaction mode worth having: a **fast conversational mode** for *discussing a topic* without triggering the full agentic loop, the snappy back-and-forth box-01 provides (terse replies, tools suppressed/minimal, low thinking level) so you can brainstorm/clarify/reason rather than task.

This is an **interaction MODE, not a voice feature**: voice is its best interface (fast feedback wants voice), but the essence is conversational-vs-agentic, and you might want the fast conversational mode even in text. Proposal: a session can be FLAGGED into this mode; when it is, the interaction gets the box-01-style fast-feedback treatment (short spoken/written turns, no heavy tool machinery). When it is not, you are in the normal agentic flow.

**Naming is open** (do NOT lock it in): "voice-live" is not right because the distinction is conversational-vs-agentic, not the medium. Candidates: `discuss` / `discussion mode` (names the intent: discuss a topic, not do work; current lean), `talk`, `converse`. Pick at spec time.

## Voice Role A: voice as the agent's I/O (wherever's own live cascade)

wherever IS the Pi session (owns the model + input), so live voice here is speak -> Pi -> speak-back, with the STT->Pi->TTS cascade hooked DIRECTLY into wherever's own session (no hop to box-01), lowest latency. Two flavours depending on the mode above:

- In **agentic** mode: full voice-driven agent console (voice controls real work). Filler on tool-start ("searching...") so the user is not left in silence during seconds-long agentic turns.
- In **conversational/"discuss"** mode: the box-01-style snappy discussion, tools suppressed, terse SPOKEN replies (humans read faster than they listen; shape via Pi AGENTS.md / persona). THIS is where Role A most resembles what box-01 does.

Reuses wherever's own model/session + STT (its Whisper), plus a TTS + a live transport (WebRTC + turn-taking/interruption/VAD, the hard parts my-boxes solved).

## Voice Role B: voice as an input-COMPOSER overlay

A live-conversation overlay whose goal is NOT to answer but to help compose a CLEAN, well-formed next input for the agentic flow, then hand that prompt to Pi. Why it beats plain dictation: naive STT mis-transcribes, ESPECIALLY non-English accents; a *conversational* loop (STT -> a small LLM that confirms/corrects/refines -> back-and-forth) yields a clean prompt before it reaches the agent. Especially valuable on MOBILE (typing annoying, naive STT worst). Shape: an overlay over the input box; you talk, it drafts/refines, you confirm, it submits.

## The key coupling refinement: Role A can PROVIDE Role B

If wherever implements Role A, it has an in-house live-conversation engine, so its Role-B overlay can be powered by THAT rather than reaching out to box-01. So box-01 is ONE possible Role-B backend, not the only one; the overlay's backend becomes a provider choice (wherever's own cascade vs box-01's cascade vs a lighter local loop). This also strengthens the shared-substrate point: once Role A exists, the live cascade is a reusable internal capability both roles draw on.

## Both/several, explore

wherever likely wants the discuss-mode + Role A + Role B, and maybe more voice integrations. Treat as a design space, not one fixed feature. Likely build order to decide at spec time: the **conversational/"discuss" mode** is arguably the foundational, highest-value piece (it is what makes voice pleasant and is useful even in text); Role A is the voice interface onto it; Role B is the mobile/accented-input overlay (which Role A can then power).

## Design questions for spec time (do NOT guess)

- Name the conversational mode (discuss / talk / converse).
- How is the mode flagged on a session, and what exactly changes when it is on (tool allow-list, thinking level, reply-length persona, transport)?
- Role A: reuse wherever's Whisper STT + add TTS + a live transport, vs adopt the my-boxes cascade wholesale? (Lean: own for A, colocated, low-latency.)
- Role B backend: wherever's own Role-A cascade, box-01, or a lighter local refinement loop? UX for confirm/submit; mobile-first.
- Shared substrate: my-boxes + wherever both converge on "Pi + STT + TTS + transport". NOTE the overlap; do not extract a shared component until both concrete efforts exist.

## Cross-refs

- ../my-boxes work/notes/ideas/voice-agent-through-pi.md (the live cascade + Pi routing + web via pi-webveil/SearXNG; box-01.ska.sh) — the source of the snappy fast-feedback behaviour this mode wants.
- wherever's existing dictation/STT (README "WAV Dictation & Speech-to-Text") is what Role B extends toward conversational refinement.
