import { useSyncExternalStore } from "react";
import { getKeybinds, subscribeKeybinds, type Binding, type KeybindId } from "./keybinds";

/// <summary>
/// Subscribes a component to the live keybind map. The returned record's identity changes
/// whenever a shortcut is rebound or reset, so keydown-effects that list it as a dependency
/// re-attach and immediately honor the new chord. Split from keybinds.ts (which stays a pure,
/// React-free leaf so the node unit test bundles without pulling in React).
/// </summary>
export function useKeybinds(): Record<KeybindId, Binding> {
  return useSyncExternalStore(subscribeKeybinds, getKeybinds, getKeybinds);
}
