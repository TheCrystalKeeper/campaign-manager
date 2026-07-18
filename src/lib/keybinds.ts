/// <summary>
/// The app's single source of truth for keyboard shortcuts. Historically every
/// shortcut was a hard-coded `event.key === "…"` check scattered across App,
/// MapCanvas, the map tools, ScenesPage and useSpaceClick; this module centralizes
/// the *action* shortcuts so the Keybinds settings page can list them, let the user
/// rebind them, and reset them to defaults.
///
/// It is deliberately a pure leaf module (no React, no react-konva) so it bundles
/// cleanly for the node unit test. The `useKeybinds` React hook lives next door in
/// `useKeybinds.ts`; consumers read the live map from there and match events with
/// `matchesBinding`.
/// </summary>

/** A single chord. `mod` = Ctrl-or-Cmd (matches the app's `ctrlKey || metaKey` idiom). */
export type Binding = { key: string; mod?: boolean; shift?: boolean; alt?: boolean };

export type KeybindGroup = "Global" | "Map tools" | "Map actions" | "Other";

/** Every rebindable action. Keep the union in sync with `KEYBIND_DEFS` below. */
export type KeybindId =
  | "undo"
  | "redo"
  | "toggleSettings"
  | "tool.select"
  | "tool.measure"
  | "tool.template"
  | "tool.draw"
  | "tool.calibrate"
  | "tool.fog"
  | "tool.pin"
  | "tool.walls"
  | "tool.lights"
  | "rotateCcw"
  | "rotateCw"
  | "deleteToken"
  | "toggleVisibility"
  | "cloneSelection"
  | "spaceClick";

export type KeybindDef = {
  id: KeybindId;
  label: string;
  hint?: string;
  group: KeybindGroup;
  defaultBinding: Binding;
  /** Only shown / matched for the DM (mirrors the underlying handler's own gating). */
  dmOnly?: boolean;
};

/** Group render order for the Keybinds page. */
export const KEYBIND_GROUPS: KeybindGroup[] = ["Global", "Map tools", "Map actions", "Other"];

// The tool.* defaults MIRROR each tool's `hotkey` field in src/map/tools/*.tsx — keep them
// in step if a tool's letter ever changes (there are only nine, so this is cheaper than pulling
// the whole react-konva tool tree into this leaf module + the node test).
export const KEYBIND_DEFS: KeybindDef[] = [
  // --- Global ------------------------------------------------------------------
  { id: "undo", label: "Undo", group: "Global", dmOnly: true, defaultBinding: { key: "z", mod: true }, hint: "Undo the last board edit. (Ctrl/⌘+Y also redoes.)" },
  { id: "redo", label: "Redo", group: "Global", dmOnly: true, defaultBinding: { key: "z", mod: true, shift: true }, hint: "Redo the last undone board edit." },
  { id: "toggleSettings", label: "Open / close Settings", group: "Global", defaultBinding: { key: "s" }, hint: "Toggle the Settings window (board only, not while typing)." },
  // --- Map tools ---------------------------------------------------------------
  { id: "tool.select", label: "Select tool", group: "Map tools", defaultBinding: { key: "v" } },
  { id: "tool.measure", label: "Measure tool", group: "Map tools", defaultBinding: { key: "m" } },
  { id: "tool.template", label: "Template tool", group: "Map tools", defaultBinding: { key: "t" } },
  { id: "tool.draw", label: "Draw tool", group: "Map tools", defaultBinding: { key: "d" } },
  { id: "tool.calibrate", label: "Calibrate grid tool", group: "Map tools", dmOnly: true, defaultBinding: { key: "g" } },
  { id: "tool.fog", label: "Fog tool", group: "Map tools", dmOnly: true, defaultBinding: { key: "f" } },
  { id: "tool.pin", label: "Map pin tool", group: "Map tools", dmOnly: true, defaultBinding: { key: "p" } },
  { id: "tool.walls", label: "Walls & doors tool", group: "Map tools", dmOnly: true, defaultBinding: { key: "w" } },
  { id: "tool.lights", label: "Lights tool", group: "Map tools", dmOnly: true, defaultBinding: { key: "l" } },
  // --- Map actions -------------------------------------------------------------
  { id: "rotateCcw", label: "Rotate token left", group: "Map actions", defaultBinding: { key: "[" }, hint: "Nudge the selected token's facing 15° counter-clockwise (hold Shift for 45°)." },
  { id: "rotateCw", label: "Rotate token right", group: "Map actions", defaultBinding: { key: "]" }, hint: "Nudge the selected token's facing 15° clockwise (hold Shift for 45°)." },
  { id: "deleteToken", label: "Delete hovered / selected", group: "Map actions", dmOnly: true, defaultBinding: { key: "x" }, hint: "Remove the hovered token or the selected wall(s). (Delete / Backspace also work.)" },
  { id: "toggleVisibility", label: "Toggle token visibility", group: "Map actions", dmOnly: true, defaultBinding: { key: "h" }, hint: "Hide/show the hovered token from players." },
  { id: "cloneSelection", label: "Clone selected walls", group: "Map actions", dmOnly: true, defaultBinding: { key: "d", mod: true }, hint: "Duplicate the selected wall(s) while the Walls tool is active." },
  // --- Other -------------------------------------------------------------------
  { id: "spaceClick", label: "SpaceBar = left click", group: "Other", defaultBinding: { key: " " }, hint: "Only active while the “SpaceBar = left click” setting is on." },
];

const DEFAULTS: Record<KeybindId, Binding> = Object.fromEntries(
  KEYBIND_DEFS.map((def) => [def.id, def.defaultBinding]),
) as Record<KeybindId, Binding>;

// --- Key normalization -------------------------------------------------------

// US-keyboard shifted punctuation → its base key, so a chord matches whether or not Shift
// alters the printed character (e.g. Shift+[ prints "{" but is still the "[" physical key).
const SHIFT_BASE: Record<string, string> = {
  "{": "[", "}": "]", ":": ";", '"': "'", "<": ",", ">": ".", "?": "/", "~": "`", "|": "\\",
  "!": "1", "@": "2", "#": "3", "$": "4", "%": "5", "^": "6", "&": "7", "*": "8", "(": "9", ")": "0",
  _: "-", "+": "=",
};

/** The layout-independent "physical" key for an event: lowercased, shifted-punctuation folded to base. */
export function physicalKey(event: Pick<KeyboardEvent, "key">): string {
  const raw = event.key;
  if (raw.length !== 1) return raw; // "Escape", "ArrowUp", "Shift", …
  return SHIFT_BASE[raw] ?? raw.toLowerCase();
}

/** True when the event is exactly this chord (key + Ctrl/Cmd + Shift + Alt all matching). */
export function matchesBinding(event: KeyboardEvent, binding: Binding | undefined): boolean {
  if (!binding) return false;
  return (
    physicalKey(event) === binding.key &&
    (event.ctrlKey || event.metaKey) === !!binding.mod &&
    event.shiftKey === !!binding.shift &&
    event.altKey === !!binding.alt
  );
}

export function bindingsEqual(a: Binding, b: Binding): boolean {
  return a.key === b.key && !!a.mod === !!b.mod && !!a.shift === !!b.shift && !!a.alt === !!b.alt;
}

/** Builds a binding from a keypress, or null for a bare modifier / Escape (used to cancel capture). */
export function bindingFromEvent(event: KeyboardEvent): Binding | null {
  const key = physicalKey(event);
  if (key === "Shift" || key === "Control" || key === "Alt" || key === "Meta" || key === "Escape") {
    return null;
  }
  const binding: Binding = { key };
  if (event.ctrlKey || event.metaKey) binding.mod = true;
  if (event.shiftKey) binding.shift = true;
  if (event.altKey) binding.alt = true;
  return binding;
}

const isMac = () => typeof navigator !== "undefined" && /mac|iphone|ipad/i.test(navigator.platform);

const PRETTY_KEY: Record<string, string> = {
  " ": "Space",
  arrowup: "↑",
  arrowdown: "↓",
  arrowleft: "←",
  arrowright: "→",
};

/** Human-readable chord, e.g. "Ctrl+Z", "⇧ ]", "V", "Space". */
export function formatBinding(binding: Binding): string {
  const parts: string[] = [];
  if (binding.mod) parts.push(isMac() ? "⌘" : "Ctrl");
  if (binding.alt) parts.push(isMac() ? "⌥" : "Alt");
  if (binding.shift) parts.push(isMac() ? "⇧" : "Shift");
  const key = binding.key;
  parts.push(PRETTY_KEY[key] ?? (key.length === 1 ? key.toUpperCase() : key));
  return parts.join("+");
}

// --- Persisted, observable store ---------------------------------------------

const STORAGE_KEY = "cm-keybinds";

function loadOverrides(): Partial<Record<KeybindId, Binding>> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: Partial<Record<KeybindId, Binding>> = {};
    for (const def of KEYBIND_DEFS) {
      const value = parsed[def.id];
      if (value && typeof (value as Binding).key === "string") {
        out[def.id] = value as Binding;
      }
    }
    return out;
  } catch {
    return {};
  }
}

function persist(overrides: Partial<Record<KeybindId, Binding>>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides));
  } catch {
    // preference just won't persist
  }
}

let overrides = loadOverrides();
let snapshot = computeSnapshot();
const listeners = new Set<() => void>();

function computeSnapshot(): Record<KeybindId, Binding> {
  const out = {} as Record<KeybindId, Binding>;
  for (const def of KEYBIND_DEFS) {
    out[def.id] = overrides[def.id] ?? def.defaultBinding;
  }
  return out;
}

function emit() {
  snapshot = computeSnapshot();
  for (const listener of listeners) listener();
}

export function subscribeKeybinds(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The current binding for every action (stable identity until something is rebound). */
export function getKeybinds(): Record<KeybindId, Binding> {
  return snapshot;
}

export function setBinding(id: KeybindId, binding: Binding) {
  overrides = { ...overrides, [id]: binding };
  persist(overrides);
  emit();
}

/** Wipe all overrides — every shortcut returns to its default. */
export function resetKeybinds() {
  overrides = {};
  persist(overrides);
  emit();
}

/** True when this action is currently on its default binding. */
export function isDefaultBinding(id: KeybindId): boolean {
  return overrides[id] === undefined;
}

/**
 * The label of another action that `binding` would collide with (same chord, overlapping
 * scope), or null. Modifier combos never clash with bare letters, so only genuine duplicates
 * are reported. Used by the page to block a clashing rebind rather than silently break a shortcut.
 */
export function findConflict(id: KeybindId, binding: Binding, isDm: boolean): string | null {
  for (const def of KEYBIND_DEFS) {
    if (def.id === id) continue;
    if (def.dmOnly && !isDm) continue;
    if (bindingsEqual(snapshot[def.id], binding)) return def.label;
  }
  return null;
}

export { DEFAULTS as KEYBIND_DEFAULTS };
