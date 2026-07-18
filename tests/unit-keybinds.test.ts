/// <summary>
/// Unit checks for the central keybind registry: event→binding matching (Ctrl⇔Cmd,
/// exact Shift/Alt, shifted-punctuation folding), display formatting, capture parsing,
/// conflict detection (self-skip + DM-only scope), and the persisted store round-trip.
/// Run: npx esbuild tests/unit-keybinds.test.ts --bundle --format=esm --platform=node
///        --outfile=<tmp>/t.mjs && node <tmp>/t.mjs
/// </summary>

import {
  matchesBinding,
  physicalKey,
  formatBinding,
  bindingsEqual,
  bindingFromEvent,
  findConflict,
  setBinding,
  resetKeybinds,
  getKeybinds,
  isDefaultBinding,
} from "../src/lib/keybinds";

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) {
    console.log(`PASS  ${name}`);
  } else {
    failures += 1;
    console.error(`FAIL  ${name}`, detail ?? "");
  }
}

type FakeKey = { key: string; ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean; altKey?: boolean };
const ev = (k: FakeKey): KeyboardEvent =>
  ({ ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...k }) as unknown as KeyboardEvent;

// --- matchesBinding ----------------------------------------------------------
{
  check("mod matches Ctrl", matchesBinding(ev({ key: "z", ctrlKey: true }), { key: "z", mod: true }));
  check("mod matches Cmd/meta", matchesBinding(ev({ key: "z", metaKey: true }), { key: "z", mod: true }));
  check(
    "undo (mod+Z) does NOT fire when Shift is held",
    !matchesBinding(ev({ key: "z", ctrlKey: true, shiftKey: true }), { key: "z", mod: true }),
  );
  check(
    "redo (mod+Shift+Z) fires with Shift",
    matchesBinding(ev({ key: "z", ctrlKey: true, shiftKey: true }), { key: "z", mod: true, shift: true }),
  );
  check("plain letter matches with no modifiers", matchesBinding(ev({ key: "s" }), { key: "s" }));
  check("plain letter rejects a stray Shift", !matchesBinding(ev({ key: "s", shiftKey: true }), { key: "s" }));
  check("plain letter rejects a stray Ctrl", !matchesBinding(ev({ key: "s", ctrlKey: true }), { key: "s" }));
  check(
    "shifted punctuation folds to base (Shift+[ ⇒ physical [)",
    matchesBinding(ev({ key: "{", shiftKey: true }), { key: "[", shift: true }),
  );
  check("alt is matched exactly", !matchesBinding(ev({ key: "d", altKey: true }), { key: "d" }));
  check("undefined binding never matches", !matchesBinding(ev({ key: "z" }), undefined));
}

// --- physicalKey -------------------------------------------------------------
{
  check("physicalKey folds { to [", physicalKey({ key: "{" }) === "[");
  check("physicalKey folds } to ]", physicalKey({ key: "}" }) === "]");
  check("physicalKey lowercases letters", physicalKey({ key: "Z" }) === "z");
  check("physicalKey keeps Space", physicalKey({ key: " " }) === " ");
  check("physicalKey leaves named keys", physicalKey({ key: "Escape" }) === "Escape");
}

// --- formatBinding (node has no navigator ⇒ Ctrl, deterministic) --------------
{
  check("format mod+Z", formatBinding({ key: "z", mod: true }) === "Ctrl+Z");
  check("format mod+Shift+Z", formatBinding({ key: "z", mod: true, shift: true }) === "Ctrl+Shift+Z");
  check("format plain letter", formatBinding({ key: "v" }) === "V");
  check("format Space", formatBinding({ key: " " }) === "Space");
  check("format bracket", formatBinding({ key: "]" }) === "]");
}

// --- bindingsEqual -----------------------------------------------------------
{
  check("equal ignores absent vs false modifiers", bindingsEqual({ key: "s" }, { key: "s", mod: false }));
  check("unequal on key", !bindingsEqual({ key: "s" }, { key: "a" }));
  check("unequal on modifier", !bindingsEqual({ key: "s" }, { key: "s", shift: true }));
}

// --- bindingFromEvent --------------------------------------------------------
{
  check("bare Shift ⇒ null", bindingFromEvent(ev({ key: "Shift", shiftKey: true })) === null);
  check("Escape ⇒ null (reserved to cancel capture)", bindingFromEvent(ev({ key: "Escape" })) === null);
  const b = bindingFromEvent(ev({ key: "a", ctrlKey: true }));
  check("builds mod chord", !!b && b.key === "a" && b.mod === true && !b.shift && !b.alt);
}

// --- findConflict (store at defaults) ----------------------------------------
{
  check(
    "detects a clash with the Settings toggle",
    findConflict("tool.select", { key: "s" }, true) === "Open / close Settings",
  );
  check("no clash for a free key", findConflict("tool.select", { key: "q" }, true) === null);
  check("skips the action being edited", findConflict("toggleSettings", { key: "s" }, true) === null);
  check(
    "DM sees a clash with a DM-only tool (Walls = w)",
    findConflict("toggleSettings", { key: "w" }, true) === "Walls & doors tool",
  );
  check(
    "player ignores DM-only bindings when checking conflicts",
    findConflict("toggleSettings", { key: "w" }, false) === null,
  );
}

// --- store: set / default flag / reset ---------------------------------------
{
  check("default toggleSettings is S", getKeybinds().toggleSettings.key === "s");
  check("isDefaultBinding true initially", isDefaultBinding("toggleSettings"));
  setBinding("toggleSettings", { key: "k" });
  check("setBinding updates the live snapshot", getKeybinds().toggleSettings.key === "k");
  check("isDefaultBinding false after rebind", !isDefaultBinding("toggleSettings"));
  resetKeybinds();
  check("resetKeybinds restores the default", getKeybinds().toggleSettings.key === "s");
  check("isDefaultBinding true after reset", isDefaultBinding("toggleSettings"));
}

// --- persistence round-trip (mock localStorage) ------------------------------
{
  const store = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
  setBinding("undo", { key: "u", mod: true });
  const saved = JSON.parse(store.get("cm-keybinds") ?? "{}") as Record<string, { key: string; mod?: boolean }>;
  check("setBinding persists the override as JSON", saved.undo?.key === "u" && saved.undo?.mod === true);
  resetKeybinds();
  check("resetKeybinds clears persisted overrides", store.get("cm-keybinds") === "{}");
  delete (globalThis as { localStorage?: unknown }).localStorage;
}

if (failures > 0) {
  console.error(`\n${failures} CHECK(S) FAILED`);
  process.exit(1);
}
console.log("\nALL CHECKS PASSED");
