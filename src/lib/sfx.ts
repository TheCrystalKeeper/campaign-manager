/// <summary>
/// Shared sample-based sound-effects layer (SOUND_DESIGN.md §2). One lazily created
/// AudioContext feeds every SFX in the app; samples are mp3 files under `public/sounds/`,
/// fetched + decoded once and cached. Playback uses AudioBufferSourceNodes (not <audio>
/// elements) for low latency, overlap, and per-play pitch jitter.
///
/// Every sound is optional: `playSfx()` returns false when a file is missing or not yet
/// decoded, so callers can fall back to their synth (dice/coin) or stay silent (tokens).
/// Drop files into `public/sounds/` incrementally — nothing ever breaks.
/// </summary>

import { getSoundGain, subscribeSoundVolume } from "./soundVolume";

export type SfxName =
  | "dice-impact-soft"
  | "dice-impact-hard"
  | "dice-shake"
  | "dice-throw"
  | "coin-flip"
  | "coin-drop"
  | "token-pickup"
  | "token-place";

/// Candidate files per sound. Multiple entries are variants: playback picks randomly
/// (never the same one twice in a row) so repeated sounds don't machine-gun. Only the
/// files that actually exist and decode are used; the rest are ignored silently.
const MANIFEST: Record<SfxName, string[]> = {
  "dice-impact-soft": ["/sounds/dice/impact-1.mp3", "/sounds/dice/impact-2.mp3"],
  "dice-impact-hard": ["/sounds/dice/impact-3.mp3", "/sounds/dice/impact-4.mp3"],
  "dice-shake": ["/sounds/dice/shake-1.mp3", "/sounds/dice/shake-2.mp3", "/sounds/dice/shake-3.mp3"],
  "dice-throw": ["/sounds/dice/throw.mp3"],
  "coin-flip": ["/sounds/coin/flip.mp3"],
  "coin-drop": ["/sounds/coin/drop-1.mp3", "/sounds/coin/drop-2.mp3", "/sounds/coin/drop-3.mp3"],
  "token-pickup": ["/sounds/tokens/pickup-1.mp3", "/sounds/tokens/pickup-2.mp3"],
  "token-place": ["/sounds/tokens/place-1.mp3", "/sounds/tokens/place-2.mp3"],
};

let ctx: AudioContext | null = null;
let master: GainNode | null = null;

// url → decoded buffer, or null once a fetch/decode has failed (missing file). Absent
// key = not attempted yet. `pending` dedupes concurrent loads of the same url.
const buffers = new Map<string, AudioBuffer | null>();
const pending = new Map<string, Promise<void>>();

// Per-sound humanization state: last variant played (avoid immediate repeats) and last
// play time (rate limit, so bursts don't stack into a roar).
const lastVariant = new Map<SfxName, string>();
const lastPlayedAt = new Map<SfxName, number>();

function ensureCtx(): AudioContext | null {
  if (ctx) {
    return ctx;
  }
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) {
    return null;
  }
  ctx = new Ctor();
  master = ctx.createGain();
  // 0.9 is the mix headroom; the user's master volume scales it (gain 1.0 at the 70 %
  // default). Subscribed once (ensureCtx only builds the graph on the first call) so the
  // slider moves this live.
  master.gain.value = 0.9 * getSoundGain();
  master.connect(ctx.destination);
  subscribeSoundVolume((gain) => {
    if (master) {
      master.gain.value = 0.9 * gain;
    }
  });
  return ctx;
}

/// <summary>The shared context, for other audio code (DiceAudio's synth) to build on —
/// browsers cap concurrent AudioContexts, so everything should share this one.</summary>
export function getSfxContext(): AudioContext | null {
  return ensureCtx();
}

/// <summary>Resumes the context after a user gesture (autoplay policy). Safe anytime.</summary>
export function resumeSfx() {
  const c = ensureCtx();
  if (c && c.state === "suspended") {
    void c.resume();
  }
}

/// <summary>
/// Starts fetching + decoding the given sounds' files in the background. Call at a natural
/// warm-up point (dice audio init, map mount) so buffers are ready before the first play.
/// Missing files fail silently and are remembered as absent.
/// </summary>
export function preloadSfx(...names: SfxName[]) {
  const c = ensureCtx();
  if (!c) {
    return;
  }
  for (const name of names) {
    for (const url of MANIFEST[name]) {
      if (buffers.has(url) || pending.has(url)) {
        continue;
      }
      const load = (async () => {
        try {
          const res = await fetch(url);
          if (!res.ok) {
            throw new Error(`${res.status}`);
          }
          const data = await res.arrayBuffer();
          // decodeAudioData also rejects HTML served for a missing path, so a dev-server
          // fallback page can never end up "playing".
          buffers.set(url, await c.decodeAudioData(data));
        } catch {
          buffers.set(url, null);
        } finally {
          pending.delete(url);
        }
      })();
      pending.set(url, load);
    }
  }
}

export interface PlaySfxOptions {
  /** Linear gain for this play (default 1, into a 0.9 master). */
  gain?: number;
  /** Random playbackRate spread, e.g. 0.06 → ±6 % (default). 0 disables. */
  pitchJitter?: number;
  /** Minimum ms between plays of this sound (default 60). 0 disables. */
  rateLimitMs?: number;
}

/// <summary>
/// Plays one variant of a named sound. Returns true if a decoded sample was scheduled;
/// false when no file is available (or the rate limit swallowed the play), letting the
/// caller decide on a fallback. Kicks off loading on a miss so later plays succeed.
/// </summary>
export function playSfx(name: SfxName, opts: PlaySfxOptions = {}): boolean {
  const c = ensureCtx();
  if (!c || !master) {
    return false;
  }
  const ready = MANIFEST[name].filter((url) => buffers.get(url));
  if (ready.length === 0) {
    preloadSfx(name); // lazy path: warm the cache for next time
    return false;
  }

  const { gain = 1, pitchJitter = 0.06, rateLimitMs = 60 } = opts;
  const now = performance.now();
  if (rateLimitMs > 0 && now - (lastPlayedAt.get(name) ?? -Infinity) < rateLimitMs) {
    return true; // a sample exists and recently played — callers must not synth on top
  }
  lastPlayedAt.set(name, now);

  let pick = ready[Math.floor(Math.random() * ready.length)];
  if (ready.length > 1 && pick === lastVariant.get(name)) {
    pick = ready[(ready.indexOf(pick) + 1) % ready.length];
  }
  lastVariant.set(name, pick);

  if (c.state === "suspended") {
    void c.resume();
  }
  const src = c.createBufferSource();
  src.buffer = buffers.get(pick)!;
  if (pitchJitter > 0) {
    src.playbackRate.value = 1 + (Math.random() * 2 - 1) * pitchJitter;
  }
  const g = c.createGain();
  g.gain.value = gain;
  src.connect(g).connect(master);
  src.start();
  return true;
}
