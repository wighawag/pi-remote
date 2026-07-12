// Inviting "agent is waiting for you" chime, synthesised with the Web Audio API
// so no audio asset needs to be bundled or fetched. The sound is deliberately
// gentle: a soft two-note rising interval (a friendly "ding-dong" that invites
// attention rather than an alarm), with a short attack and a smooth decay so it
// never clips or sounds harsh.
//
// Browsers block audio until the user has interacted with the page, so the
// AudioContext is created lazily on the first play and any failure is swallowed
// (a beep is a nicety, never a hard requirement).

let audioCtx: AudioContext | null = null;

function getContext(): AudioContext | null {
	if (typeof window === 'undefined') return null;
	try {
		if (!audioCtx) {
			const Ctor =
				window.AudioContext ||
				(window as unknown as {webkitAudioContext?: typeof AudioContext})
					.webkitAudioContext;
			if (!Ctor) return null;
			audioCtx = new Ctor();
		}
		// A context can be left 'suspended' until a user gesture resumes it.
		if (audioCtx.state === 'suspended') {
			// Best-effort; if it stays suspended the play simply produces no sound.
			audioCtx.resume().catch(() => {});
		}
		return audioCtx;
	} catch {
		return null;
	}
}

// Play one note (a sine tone) with a soft attack/decay envelope.
function playNote(
	ctx: AudioContext,
	frequency: number,
	startTime: number,
	duration: number,
	peakGain: number,
): void {
	const osc = ctx.createOscillator();
	const gain = ctx.createGain();
	osc.type = 'sine';
	osc.frequency.value = frequency;

	// Envelope: quick-but-not-instant attack, then an exponential fade so the
	// tail is smooth (no click). exponentialRampToValueAtTime cannot target 0,
	// so we ramp to a tiny value and stop just after.
	const attack = 0.015;
	gain.gain.setValueAtTime(0.0001, startTime);
	gain.gain.exponentialRampToValueAtTime(peakGain, startTime + attack);
	gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

	osc.connect(gain);
	gain.connect(ctx.destination);
	osc.start(startTime);
	osc.stop(startTime + duration + 0.02);
}

// Cache one Audio element per custom sound URL so we do not re-fetch/re-decode
// on every play. Rewinding a reused element is cheaper and avoids a growing pile
// of elements.
const customAudioCache = new Map<string, HTMLAudioElement>();

// Play a user-supplied sound file (URL/path). Returns true if playback was
// started (or at least attempted without throwing synchronously), false if it
// could not be set up so the caller can fall back to the synthesized chime.
function playCustomSound(url: string): boolean {
	if (typeof Audio === 'undefined') return false;
	try {
		let el = customAudioCache.get(url);
		if (!el) {
			el = new Audio(url);
			el.preload = 'auto';
			customAudioCache.set(url, el);
		}
		try {
			el.currentTime = 0;
		} catch {
			// Some elements throw if not yet seekable; ignore and let play() handle it.
		}
		// play() returns a promise that rejects if blocked (autoplay policy) or the
		// source failed to load. Swallow both: a beep is a nicety.
		const p = el.play();
		if (p && typeof p.catch === 'function') p.catch(() => {});
		return true;
	} catch {
		return false;
	}
}

/**
 * Play the inviting waiting-for-human chime. Safe to call from anywhere; a no-op
 * (rather than a throw) when audio is unavailable or blocked.
 *
 * When `soundUrl` is provided (a user-configured sound file), it is played
 * instead of the synthesized chime; if that cannot be set up, we fall back to
 * the built-in two-note chime (C6 then F6, a gentle rising interval that reads
 * as a friendly "you're up" prompt).
 */
export function playInvitingBeep(soundUrl?: string): void {
	if (soundUrl && soundUrl.trim()) {
		if (playCustomSound(soundUrl.trim())) return;
		// else fall through to the synthesized chime.
	}
	const ctx = getContext();
	if (!ctx) return;
	try {
		const now = ctx.currentTime;
		// Two soft rising notes: C6 then F6 (a gentle, welcoming interval).
		playNote(ctx, 1046.5, now, 0.16, 0.12);
		playNote(ctx, 1396.9, now + 0.13, 0.22, 0.12);
	} catch {
		// Swallow: the beep is a nicety, never a hard requirement.
	}
}
