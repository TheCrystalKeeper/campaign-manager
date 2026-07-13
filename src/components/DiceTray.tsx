import { useEffect, useRef, useState } from "react";
import { CircleDollarSign, Info, Lock, Undo2, Volume2, VolumeX, X } from "lucide-react";
import { DICE_QUICK_SIDES } from "../lib/dice";
import { playRollSound } from "../lib/rollSound";
import { clampToViewport } from "../lib/clampToViewport";
import { campaignKey } from "../lib/campaignStore";
import type { DiceOverlayController } from "../dice/useDiceOverlay";

type DiceTrayProps = {
  /** Slides/fades into view when true, out when false (stays mounted). */
  open: boolean;
  /** Campaign id — the tray position is remembered per campaign. */
  roomId: string;
  isDm: boolean;
  secret: boolean;
  onToggleSecret: (on: boolean) => void;
  controller: DiceOverlayController;
  /** Text-roll fallback (3D off, engine warming up, or invalid for 3D). */
  onTextRoll: (expression: string) => void;
  onClose: () => void;
  /** Bumped by "Reset UI layout" — the tray returns to its default position. */
  resetSignal?: number;
};

type TrayPos = { x: number; y: number };
type TraySize = { w: number; h: number };

// Position is namespaced per campaign (`cm:{roomId}:tray`); falls back to the pre-namespacing
// global key for a one-time migration.
const posKey = (roomId: string) => campaignKey(roomId, "tray");
const LEGACY_POS_KEY = "cm-dice-tray-pos";
const MARGIN = 8;
const DRAG_THRESHOLD = 5;
// Estimates used before the tray is measured (keeps the initial clamp sane).
const EST_SIZE: TraySize = { w: 500, h: 170 };

/// <summary>Keeps the whole tray on screen (with a margin), using its measured size.</summary>
function clampPos(pos: TrayPos, size: TraySize = EST_SIZE): TrayPos {
  return clampToViewport(pos, size, MARGIN);
}

function defaultPos(size: TraySize = EST_SIZE): TrayPos {
  return {
    x: Math.round((window.innerWidth - size.w) / 2),
    y: window.innerHeight - size.h - 12,
  };
}

function savePos(roomId: string, pos: TrayPos) {
  try {
    localStorage.setItem(posKey(roomId), JSON.stringify(pos));
  } catch {
    // position just won't persist
  }
}

function loadPos(roomId: string): TrayPos {
  try {
    const raw = localStorage.getItem(posKey(roomId)) ?? localStorage.getItem(LEGACY_POS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as TrayPos;
      if (typeof parsed?.x === "number" && typeof parsed?.y === "number") {
        // Return the stored spot as-is; the mount effect re-clamps it with the tray's REAL
        // measured size. Clamping here with EST_SIZE would nudge a bottom-anchored position
        // (saved from the real size) up/sideways, so it wouldn't land where it was saved.
        return parsed;
      }
    }
  } catch {
    // fall through to default
  }
  return defaultPos();
}

/// <summary>
/// The dice tray: a draggable rack of 3D dice in a felt well. Click a d# button to ready
/// dice — the matching dice glow (click again for more, right-click to put one back) —
/// then drag any glowing die out of the tray to pick the whole set up, shake, and throw
/// onto the board. With 3D off, the d# buttons and Roll do text rolls (with a dice-roll
/// sound). **Drag anywhere on the tray** (except the felt well, which grabs dice) to move
/// it; a small move threshold keeps button clicks working. Double-click a blank part of
/// the tray to reset its position. Toggling slides/fades it in and out where it sits.
/// </summary>
export function DiceTray({
  open,
  roomId,
  isDm,
  secret,
  onToggleSecret,
  controller,
  onTextRoll,
  onClose,
  resetSignal,
}: DiceTrayProps) {
  const [expression, setExpression] = useState("1d20");
  const [pos, setPos] = useState<TrayPos>(() => loadPos(roomId));
  const [showFairness, setShowFairness] = useState(false);
  const trayRef = useRef<HTMLDivElement>(null);
  const suppressClickRef = useRef(false);
  const lastResetRef = useRef(resetSignal);
  const fairnessRef = useRef<HTMLDivElement>(null);
  const fairnessBtnRef = useRef<HTMLButtonElement>(null);

  const selectionActive = Object.keys(controller.selection).length > 0;

  const measure = (): TraySize =>
    trayRef.current
      ? { w: trayRef.current.offsetWidth, h: trayRef.current.offsetHeight }
      : EST_SIZE;

  // A text roll (non-3D): play the dice sound, then resolve it as a server text roll.
  const textRoll = (expr: string) => {
    playRollSound();
    onTextRoll(expr);
  };

  // Pull the tray fully on-screen once we know its real size, and on window resize.
  useEffect(() => {
    setPos((current) => clampPos(current, measure()));
    const onResize = () => setPos((current) => clampPos(current, measure()));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // "Reset UI layout" (settings): back to the default bottom-center spot. Persist it (like
  // the drag and double-click resets) so a reload returns here — otherwise the last SAVED
  // position (from an earlier drag) is restored instead of this reset.
  useEffect(() => {
    if (lastResetRef.current === resetSignal) {
      return;
    }
    lastResetRef.current = resetSignal;
    const next = clampPos(defaultPos(measure()), measure());
    setPos(next);
    savePos(roomId, next);
  }, [resetSignal, roomId]);

  // Esc puts readied dice back.
  useEffect(() => {
    if (!selectionActive) {
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        controller.clearSelection();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectionActive, controller]);

  // While the "how rolls are decided" note is open, a press anywhere outside it closes it.
  // The info button itself is exempt so its own onClick handles the toggle (no reopen), and
  // Esc closes it too. Capture phase so it fires even if an inner handler stops propagation.
  useEffect(() => {
    if (!showFairness) {
      return;
    }
    const onDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (fairnessRef.current?.contains(target) || fairnessBtnRef.current?.contains(target)) {
        return;
      }
      setShowFairness(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setShowFairness(false);
      }
    };
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [showFairness]);

  const rollExpression = () => {
    // Highlighted dice win over the text box: Roll throws the readied selection.
    if (selectionActive) {
      if (!controller.throwSelection()) {
        // 3D engine not ready — resolve as text rolls instead, one per die type
        // (the roll parser only understands a single NdM±K term).
        const picks = Object.entries(controller.selection);
        playRollSound();
        for (const [sides, count] of picks) {
          onTextRoll(`${count}d${sides}`);
        }
        controller.clearSelection();
      }
      return;
    }
    const expr = expression.trim();
    if (!expr) {
      return;
    }
    if (!controller.throwExpression(expr)) {
      textRoll(expr);
    }
  };

  /// <summary>Starts a threshold drag from anywhere on the tray except the dice well.</summary>
  const onTrayPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return;
    }
    const target = event.target as HTMLElement;
    if (target.closest(".dice-tray-well")) {
      return; // the felt well grabs dice, not the tray
    }
    const startX = event.clientX;
    const startY = event.clientY;
    const baseX = pos.x;
    const baseY = pos.y;
    const offX = event.clientX - pos.x;
    const offY = event.clientY - pos.y;
    const size = measure();
    const el = trayRef.current;
    let moved = false;

    const onMove = (e: PointerEvent) => {
      if (!moved && Math.hypot(e.clientX - startX, e.clientY - startY) < DRAG_THRESHOLD) {
        return; // below threshold — still a click
      }
      if (!moved) {
        moved = true;
        // Move on the compositor (transform) and drop the paint-heavy notch overlay for the drag,
        // so dragging never repaints the whole tray + its 12-layer edge frame each frame.
        if (el) {
          el.style.willChange = "transform";
          el.classList.add("dragging");
        }
      }
      e.preventDefault();
      const clamped = clampPos({ x: e.clientX - offX, y: e.clientY - offY }, size);
      if (el) {
        el.style.transform = `translate3d(${clamped.x - baseX}px, ${clamped.y - baseY}px, 0)`;
      }
    };
    const onUp = (e: PointerEvent) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      if (moved) {
        // Swallow the click that follows a drag so it doesn't trigger a button.
        suppressClickRef.current = true;
        setTimeout(() => (suppressClickRef.current = false), 60);
        const clamped = clampPos({ x: e.clientX - offX, y: e.clientY - offY }, size);
        if (el) {
          // Land via left/top and clear the transform + overlay suppression in the same frame so
          // there's no jump-back flash before React commits the new position.
          el.style.transform = "";
          el.style.left = `${clamped.x}px`;
          el.style.top = `${clamped.y}px`;
          el.style.willChange = "";
          el.classList.remove("dragging");
        }
        setPos(clamped);
        savePos(roomId, clamped);
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const onTrayDoubleClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest("button, input, .dice-tray-well")) {
      return; // don't reset when double-clicking a control or the dice well
    }
    const next = clampPos(defaultPos(measure()), measure());
    setPos(next);
    savePos(roomId, next);
  };

  return (
    <div
      ref={trayRef}
      className={`dice-tray${open ? " dice-tray--open" : ""}`}
      style={{ left: pos.x, top: pos.y }}
      aria-hidden={!open}
      onPointerDown={onTrayPointerDown}
      onDoubleClick={onTrayDoubleClick}
      onClickCapture={(event) => {
        if (suppressClickRef.current) {
          suppressClickRef.current = false;
          event.stopPropagation();
          event.preventDefault();
        }
      }}
    >
      {controller.enabled ? (
        <div
          className="dice-tray-well"
          ref={controller.trayMountRef}
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            if (controller.grabFromTray(event)) {
              event.preventDefault();
            }
          }}
        />
      ) : null}

      <div className="dice-tray-controls">
        <button
          className="chip-btn dice-put-back"
          disabled={!selectionActive}
          title="Put all readied dice back (Esc). Right-click a d# button to put back just one."
          onClick={controller.clearSelection}
        >
          <Undo2 size={14} strokeWidth={2.2} />
        </button>

        {(() => {
          const count = controller.selection[2] ?? 0;
          return (
            <button
              key="coin"
              className={`die-btn die-btn--coin${count > 0 ? " die-btn--sel" : ""}`}
              title={
                controller.enabled
                  ? "Coin — click to ready it (right-click puts it back), then drag it out of the tray to flip"
                  : "Coin flip"
              }
              onClick={() => {
                if (controller.enabled) {
                  controller.adjustSelection(2, 1);
                } else {
                  textRoll("1d2");
                }
              }}
              onContextMenu={(event) => {
                if (controller.enabled) {
                  event.preventDefault();
                  controller.adjustSelection(2, -1);
                }
              }}
            >
              <CircleDollarSign size={15} strokeWidth={2.2} />
              {count > 0 ? <span className="die-count">{count}</span> : null}
            </button>
          );
        })()}
        {DICE_QUICK_SIDES.map((sides) => {
          const count = controller.selection[sides] ?? 0;
          return (
            <button
              key={sides}
              className={`die-btn${count > 0 ? " die-btn--sel" : ""}${sides === 20 ? " btn-crystal" : ""}`}
              title={
                controller.enabled
                  ? `d${sides} — click to ready a die (right-click puts one back), then drag it out of the tray to throw`
                  : `d${sides} — roll 1d${sides}`
              }
              onClick={() => {
                if (controller.enabled) {
                  controller.adjustSelection(sides, 1);
                } else {
                  textRoll(`1d${sides}`);
                }
              }}
              onContextMenu={(event) => {
                if (controller.enabled) {
                  event.preventDefault();
                  controller.adjustSelection(sides, -1);
                }
              }}
            >
              d{sides}
              {count > 0 ? <span className="die-count">{count}</span> : null}
            </button>
          );
        })}

        <input
          className="dice-tray-expr"
          value={expression}
          onChange={(e) => setExpression(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") rollExpression();
          }}
          placeholder="2d6+3"
          aria-label="Dice expression"
        />
        <button
          className="btn-primary"
          title={selectionActive ? "Roll the highlighted dice" : "Roll the expression"}
          onClick={rollExpression}
        >
          Roll
        </button>

        {isDm ? (
          <button
            className={`chip-btn ${secret ? "btn-active" : ""}`}
            title="While on, every roll you make is secret — players see blank dice and a masked log entry"
            onClick={() => onToggleSecret(!secret)}
          >
            <Lock size={14} strokeWidth={2.2} />
          </button>
        ) : null}
        <button
          className={`chip-btn ${controller.enabled ? "btn-active" : ""}`}
          title={controller.enabled ? "3D dice: on" : "3D dice: off (text rolls)"}
          onClick={() => controller.setEnabled(!controller.enabled)}
        >
          3D
        </button>
        {controller.enabled ? (
          <button
            className="chip-btn"
            title={controller.muted ? "Unmute dice" : "Mute dice"}
            onClick={() => controller.setMuted(!controller.muted)}
          >
            {controller.muted ? <VolumeX size={14} strokeWidth={2.2} /> : <Volume2 size={14} strokeWidth={2.2} />}
          </button>
        ) : null}
        <button
          ref={fairnessBtnRef}
          className={`chip-btn ${showFairness ? "btn-active" : ""}`}
          title="How rolls are decided"
          aria-label="How rolls are decided"
          aria-expanded={showFairness}
          onClick={() => setShowFairness((v) => !v)}
        >
          <Info size={14} strokeWidth={2.2} />
        </button>
        <button className="btn-ghost icon-btn" title="Hide tray" onClick={onClose}>
          <X size={14} strokeWidth={2.2} />
        </button>
      </div>

      {showFairness ? (
        <div className="dice-fairness-note" role="note" ref={fairnessRef}>
          <strong>Provably fair.</strong> Every roll's result — dice faces and coin
          flips — is chosen on the server with a cryptographic random generator. The 3D
          throw is just an animation: <em>how</em> you roll only changes how the dice
          tumble, never the outcome, so a roll can't be nudged in anyone's favor.
        </div>
      ) : null}
    </div>
  );
}
