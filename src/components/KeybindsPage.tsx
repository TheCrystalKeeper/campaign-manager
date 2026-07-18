import { useEffect, useState } from "react";
import type { PanelContext } from "../panels/registry";
import { useKeybinds } from "../lib/useKeybinds";
import {
  KEYBIND_DEFS,
  KEYBIND_GROUPS,
  bindingFromEvent,
  findConflict,
  formatBinding,
  isDefaultBinding,
  resetKeybinds,
  setBinding,
  type KeybindId,
} from "../lib/keybinds";

/** Standard keys the app leans on everywhere — listed for reference, not rebindable. */
const REFERENCE_ROWS: Array<{ keys: string; desc: string }> = [
  { keys: "Enter", desc: "Submit an edit, send a chat message, or roll the dice expression" },
  { keys: "Esc", desc: "Close the top window, cancel a drag, or reset the map tool to Select" },
  { keys: "↑ ↓ ← →", desc: "Move the selection in lists and the compendium picker" },
  { keys: "Shift / Ctrl + click", desc: "Add to a multi-selection (tokens, walls, directory)" },
  { keys: "Shift + drag", desc: "Advantage on a roll, snap rotation to 45°, or draw a pointer" },
  { keys: "Alt + drag", desc: "Disadvantage on a roll, or erase with the fog brush" },
];

/// <summary>
/// The Keybinds sub-page of Settings: every action shortcut grouped and rebindable (click a
/// chip, press the new chord), a read-only reference for the standard Enter/Esc/arrow keys, and
/// a Reset-to-defaults button. Rendered in place of the main settings body while
/// `ctx.settingsView === "keybinds"`; the window's Back button (in FloatingWindow) returns here.
/// </summary>
export function KeybindsPage({ ctx }: { ctx: PanelContext }) {
  const { isDm } = ctx;
  const keybinds = useKeybinds();
  const [capturingId, setCapturingId] = useState<KeybindId | null>(null);
  const [conflict, setConflict] = useState<{ id: KeybindId; label: string } | null>(null);
  const [resetFlash, setResetFlash] = useState(false);

  // While capturing, own the keyboard: the next chord (capture phase, so it beats the map/global
  // hotkey listeners underneath) becomes the new binding. Escape cancels; a clash is blocked with
  // an inline note so an existing shortcut is never silently broken.
  useEffect(() => {
    if (!capturingId) return;
    const onKey = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.key === "Escape") {
        setCapturingId(null);
        setConflict(null);
        return;
      }
      const binding = bindingFromEvent(event);
      if (!binding) return; // a bare modifier — wait for the real key
      const clash = findConflict(capturingId, binding, isDm);
      if (clash) {
        setConflict({ id: capturingId, label: clash });
        return;
      }
      setBinding(capturingId, binding);
      setCapturingId(null);
      setConflict(null);
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, [capturingId, isDm]);

  const startCapture = (id: KeybindId) => {
    setConflict(null);
    setCapturingId(id);
  };

  return (
    <div className="panel-body stack">
      <p className="muted" style={{ fontSize: "0.75rem", margin: 0 }}>
        Click a shortcut, then press the key (or combo) you want. Press Esc to cancel.
      </p>

      {KEYBIND_GROUPS.map((group) => {
        const defs = KEYBIND_DEFS.filter((def) => def.group === group && (!def.dmOnly || isDm));
        if (defs.length === 0) return null;
        return (
          <div key={group} className="stack" style={{ gap: "0.4rem" }}>
            <div className="section-title">{group}</div>
            {defs.map((def) => {
              const capturing = capturingId === def.id;
              const clashing = conflict?.id === def.id;
              return (
                <div key={def.id}>
                  <div className="row" style={{ justifyContent: "space-between" }}>
                    <label style={{ margin: 0 }} title={def.hint}>
                      {def.label}
                    </label>
                    <button
                      className={`keybind-chip${capturing ? " keybind-chip--capturing" : ""}${
                        !isDefaultBinding(def.id) ? " keybind-chip--custom" : ""
                      }`}
                      title={def.hint ?? "Click to rebind"}
                      onClick={() => (capturing ? setCapturingId(null) : startCapture(def.id))}
                    >
                      {capturing ? "Press a key…" : formatBinding(keybinds[def.id])}
                    </button>
                  </div>
                  {clashing ? (
                    <span className="muted" style={{ fontSize: "0.7rem", color: "var(--danger)" }}>
                      Already used by “{conflict.label}” — try another key.
                    </span>
                  ) : null}
                </div>
              );
            })}
          </div>
        );
      })}

      <div className="section-title">Standard keys</div>
      <p className="muted" style={{ fontSize: "0.75rem", margin: 0 }}>
        Built-in keys that work throughout the app. These aren’t customizable.
      </p>
      {REFERENCE_ROWS.map((ref) => (
        <div key={ref.keys} className="row" style={{ justifyContent: "space-between", gap: "0.6rem" }}>
          <span className="muted" style={{ fontSize: "0.8rem" }}>
            {ref.desc}
          </span>
          <span className="keybind-chip keybind-chip--static">{ref.keys}</span>
        </div>
      ))}

      <div className="section-title">Reset</div>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <label style={{ margin: 0 }} title="Return every shortcut above to its original key">
          All shortcuts
        </label>
        <button
          onClick={() => {
            resetKeybinds();
            setCapturingId(null);
            setConflict(null);
            setResetFlash(true);
            setTimeout(() => setResetFlash(false), 1500);
          }}
        >
          {resetFlash ? "Reset ✓" : "Reset to defaults"}
        </button>
      </div>
    </div>
  );
}
