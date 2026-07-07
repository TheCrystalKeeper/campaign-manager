import { useEffect, useRef, useState } from "react";
import { Circle, Group, Path } from "react-konva";
import type { MapTool, ToolRuntime } from "./types";

/// <summary>
/// Map pins (Phase 7): a DM-only tool that drops a 📍 note at the click point. Pins are
/// persistent, DM-only annotations (stripped from player frames by redactStateFor), so the
/// DM can mark secrets/reminders on the map that players never see. Click empty space to place,
/// then type the note into the inline editor MapCanvas anchors at the drop point (see
/// PinNoteEditor). On an existing pin: drag the marker to move it, click its note (or
/// double-click the marker) to edit, and right-click to remove it.
/// </summary>

/// A pending pin editor: a fresh drop (no `id`) or an edit of an existing pin (`id` + `text`).
export type PinDraft = { x: number; y: number; id?: string; text?: string };

const PIN_COLOR = "#e9c176";

/// Teardrop map-pin outline whose *tip is at the local origin (0,0)* — so a Group placed at the
/// pin's world coords anchors the point exactly under the cursor (an emoji glyph can't be
/// precisely centered this way). Head circle centered at (0,-18) r≈8; peak at y≈-26.
const PIN_PATH = "M0 0 C -4 -7 -8 -10 -8 -18 A 8 8 0 1 1 8 -18 C 8 -10 4 -7 0 0 Z";

/// Glyph scale. Scaling the marker's Group around its (0,0) origin keeps the tip pinned to the
/// exact drop point while making the whole marker bigger. Label offsets in PinNode assume this.
const PIN_SCALE = 1.4;

/// <summary>
/// The on-map pin glyph: a filled teardrop with a hollow center dot, tip anchored at (0,0).
/// Shared by the placement preview and the committed-pin node so both look identical and stay
/// centred on the cursor. `highlighted` brightens it + adds a glow for hover feedback.
///
/// Both shapes carry the "map-handle" name so the stage's tool handler skips them (grabbing a
/// pin never drops a fresh pin underneath), plus "pin-marker" so PinNode can tell a marker grab
/// (start a move) from a label click (edit the note).
/// </summary>
export function PinMarker({ highlighted = false }: { highlighted?: boolean }) {
  return (
    // Scaled from the (0,0) origin so the teardrop tip stays exactly on the drop point.
    <Group scaleX={PIN_SCALE} scaleY={PIN_SCALE}>
      <Path
        name="map-handle pin-marker"
        data={PIN_PATH}
        fill={highlighted ? "#ffe0a3" : PIN_COLOR}
        stroke={highlighted ? "#fff6e0" : "#6f5116"}
        strokeWidth={highlighted ? 2 : 1.5}
        shadowColor="#000"
        shadowBlur={highlighted ? 9 : 3}
        shadowOpacity={0.5}
        shadowOffsetY={1}
      />
      <Circle name="map-handle pin-marker" x={0} y={-18} radius={3} fill="#2a1e0a" />
    </Group>
  );
}

/** Builds and sends the ADD_ANNOTATION message for a freshly placed pin. */
export function commitPin(rt: ToolRuntime, draft: PinDraft, text: string) {
  rt.send({
    type: "ADD_ANNOTATION",
    sceneId: rt.scene.id,
    annotation: {
      id: `pin-${crypto.randomUUID().slice(0, 8)}`,
      authorId: rt.yourPlayerId ?? "dm",
      kind: "pin",
      x: draft.x,
      y: draft.y,
      text: text.slice(0, 200),
      color: PIN_COLOR,
      width: 2,
      createdAt: Date.now(),
      ephemeral: false,
      dmOnly: true,
    },
  });
}

/** Sends an in-place note edit for an existing pin. */
export function updatePin(rt: ToolRuntime, annotationId: string, text: string) {
  rt.send({
    type: "UPDATE_ANNOTATION",
    sceneId: rt.scene.id,
    annotationId,
    text: text.slice(0, 200),
  });
}

/** Sends a new position for an existing pin (drag-to-move). */
export function movePin(rt: ToolRuntime, annotationId: string, x: number, y: number) {
  rt.send({ type: "UPDATE_ANNOTATION", sceneId: rt.scene.id, annotationId, x, y });
}

export const pinTool: MapTool = {
  id: "pin",
  label: "Map pin",
  icon: "📍",
  hotkey: "p",
  dmOnly: true,
  cursor: "crosshair",
  onDown: (event, rt: ToolRuntime) => {
    // One editor at a time: while a dropped pin is still awaiting its note, ignore further
    // clicks so a stray second click can't spam blank pins or move the pending one.
    if (rt.draft) {
      return;
    }
    // Placing a pin just stakes out the spot; MapCanvas renders <PinNoteEditor> there (a real
    // DOM popover can't live inside a Konva Layer) and calls commitPin once the note is saved.
    rt.setDraft({ x: event.world.x, y: event.world.y } satisfies PinDraft);
  },
  renderDraft: (draft, _rt) => {
    const d = draft as PinDraft | null;
    // Editing an existing pin (`id` set) — the real pin is already on the map, so no preview.
    if (!d || d.id) {
      return null;
    }
    return (
      <Group x={d.x} y={d.y} listening={false} opacity={0.85}>
        <PinMarker />
      </Group>
    );
  },
};

/// <summary>
/// The DOM popover MapCanvas anchors at a pin's screen position (replacing the old
/// window.prompt), used both for a fresh drop and for editing an existing pin (seeded with
/// `initialText`). Autofocuses the field; Enter or Save commits the note (an empty note is
/// allowed — the pin is still a location marker), Esc or Cancel discards the change.
///
/// Robustness: placing the pin triggers a burst of canvas focus churn on the same click, so the
/// editor ignores blur until it has "settled" (a short timer after mount) — before then a stray
/// blur just re-focuses the field rather than closing the editor out from under the user. After
/// it settles, clicking away commits the text (or cancels if the field is still empty).
/// </summary>
export function PinNoteEditor({
  x,
  y,
  initialText = "",
  onCommit,
  onCancel,
}: {
  x: number;
  y: number;
  initialText?: string;
  onCommit: (text: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState(initialText);
  const textRef = useRef(text);
  textRef.current = text;
  const doneRef = useRef(false);
  const settledRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
    const t = setTimeout(() => {
      settledRef.current = true;
    }, 250);
    return () => clearTimeout(t);
  }, []);

  const commit = () => {
    if (doneRef.current) return;
    doneRef.current = true;
    onCommit(textRef.current);
  };
  const cancel = () => {
    if (doneRef.current) return;
    doneRef.current = true;
    onCancel();
  };

  return (
    <div className="map-pin-editor" style={{ left: x, top: y }}>
      <input
        ref={inputRef}
        className="map-pin-editor__field"
        value={text}
        maxLength={200}
        placeholder="Pin note (DM-only)…"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            cancel();
          }
        }}
        onBlur={() => {
          // Ignore the placing click's focus churn; only act once the editor has settled.
          if (!settledRef.current) {
            requestAnimationFrame(() => inputRef.current?.focus());
            return;
          }
          if (textRef.current.trim()) {
            commit();
          } else {
            cancel();
          }
        }}
      />
      <div className="map-pin-editor__actions">
        <button type="button" className="btn-primary" onMouseDown={(e) => e.preventDefault()} onClick={commit}>
          Save
        </button>
        <button type="button" className="btn-ghost" onMouseDown={(e) => e.preventDefault()} onClick={cancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
