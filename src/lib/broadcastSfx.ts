/// <summary>
/// One per-device switch for "let other players hear the sound effects I make" — the
/// table-manners toggle. It gates the OUTBOUND half of shared sound: token handling
/// (pickup/place) and dice/coin throws. When OFF, this client still hears its own sounds
/// locally; it just stops broadcasting them, so the rest of the table goes quiet for you.
///
/// Sending code reads getBroadcastSfx() live at send time; the toolbar button reflects and
/// flips it via subscribe (mirrors soundVolume.ts). Persisted in localStorage, default ON.
/// </summary>

const KEY = "cm-broadcast-sfx";

type Listener = (on: boolean) => void;
const listeners = new Set<Listener>();

function read(): boolean {
  try {
    // Absent = on (the friendly default: the table hears each other unless you opt out).
    return window.localStorage.getItem(KEY) !== "0";
  } catch {
    return true;
  }
}

let enabled = read();

/// <summary>Whether this client's sound effects should reach the rest of the table.</summary>
export function getBroadcastSfx(): boolean {
  return enabled;
}

/// <summary>Sets and persists the broadcast switch, notifying subscribers (the toolbar button).</summary>
export function setBroadcastSfx(next: boolean) {
  enabled = next;
  try {
    window.localStorage.setItem(KEY, next ? "1" : "0");
  } catch {
    // storage unavailable — the in-memory value still drives this session
  }
  for (const listener of listeners) {
    listener(enabled);
  }
}

/// <summary>Subscribes to changes; returns an unsubscribe. Does not fire immediately —
/// read getBroadcastSfx() for the initial value.</summary>
export function subscribeBroadcastSfx(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
