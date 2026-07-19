/// <summary>
/// The one master volume knob for every sound in the app. All three audio paths — the
/// shared sample layer (sfx.ts), the dice synth (dice/audio.ts), and the text-roll sound
/// (rollSound.ts) — read this and subscribe to live changes, so a single Settings slider
/// scales the whole mix. Persisted per device in localStorage. Muting stays a separate
/// preference (`dice-muted`); this only sets loudness.
///
/// The slider is 0..1 (0..100 %). UNITY_AT (0.7) is the position that reproduces the app's
/// original full loudness, so the default sits there and the user can push PAST it — up to
/// 100 % — to make everything louder than it used to go. Hence gain = volume / UNITY_AT:
/// 0.7 → 1.0 (old max), 1.0 → ~1.43 (louder), 0 → silent.
/// </summary>

const KEY = "cm-sound-volume";

/// The slider position (0..1) that maps to unity gain — i.e. the app's original loudness.
const UNITY_AT = 0.7;

type Listener = (gain: number) => void;
const listeners = new Set<Listener>();

const clamp = (v: number) => Math.max(0, Math.min(1, v));

function read(): number {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw === null) {
      return UNITY_AT;
    }
    const n = Number(raw);
    return Number.isFinite(n) ? clamp(n) : UNITY_AT;
  } catch {
    return UNITY_AT;
  }
}

let volume = read();

/// <summary>Raw slider value, 0..1 (0..100 %). For the Settings UI, not for gain nodes.</summary>
export function getSoundVolume(): number {
  return volume;
}

/// <summary>Multiplier to apply to a sound's normal level: 1.0 at the 70 % default (the app's
/// original full loudness), rising above 1 past that. This is what audio nodes should use.</summary>
export function getSoundGain(): number {
  return volume / UNITY_AT;
}

/// <summary>Sets and persists the master volume (raw 0..1), notifying every live audio node
/// with the resulting gain.</summary>
export function setSoundVolume(next: number) {
  volume = clamp(next);
  try {
    window.localStorage.setItem(KEY, String(volume));
  } catch {
    // storage full / unavailable — the in-memory value still drives this session
  }
  const gain = getSoundGain();
  for (const l of listeners) {
    l(gain);
  }
}

/// <summary>Subscribes to volume changes; the listener receives the gain multiplier (see
/// getSoundGain). Returns an unsubscribe. Does not fire immediately — read getSoundGain()
/// for the initial value when wiring a gain node.</summary>
export function subscribeSoundVolume(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
