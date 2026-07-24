import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { clampToViewport } from "../lib/clampToViewport";
import type { AnchorRect } from "./useAnchorRect";
import type { TutorialStep } from "./types";

const POPOVER_GAP = 14;
const SPOTLIGHT_PAD = 6;

type Placement = "top" | "bottom" | "left" | "right";

function rectsIntersect(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function dedupePlacements(items: (Placement | undefined | null)[]): Placement[] {
  const seen = new Set<Placement>();
  const out: Placement[] = [];
  for (const p of items) {
    if (p && !seen.has(p)) {
      seen.add(p);
      out.push(p);
    }
  }
  return out;
}

type TutorialOverlayProps = {
  step: TutorialStep;
  /** Ring position (the highlighted element). */
  rect: AnchorRect | null;
  /** Popover positions relative to this rect (defaults to ring rect). */
  popoverRect: AnchorRect | null;
  stepIndex: number;
  stepCount: number;
  actionDone: boolean;
  onNext: () => void;
  onBack: () => void;
  onExit: () => void;
};

/**
 * The walkthrough's visual layer, portaled over the app (z 5000). No dim —
 * everything stays interactive. The ring highlights the anchor; the parchment
 * popover gives instructions. The placement algorithm avoids covering the ring.
 */
export function TutorialOverlay({
  step,
  rect,
  popoverRect: popoverRectProp,
  stepIndex,
  stepCount,
  actionDone,
  onNext,
  onBack,
  onExit,
}: TutorialOverlayProps) {
  const popRef = useRef<HTMLDivElement | null>(null);
  const [popPos, setPopPos] = useState<{ x: number; y: number } | null>(null);
  const [confirmingExit, setConfirmingExit] = useState(false);

  useEffect(() => setConfirmingExit(false), [step.id]);

  // Ring rect (what the gold ring wraps).
  const ringHole = useMemo(() => {
    if (!rect) return null;
    return {
      left: Math.max(0, rect.left - SPOTLIGHT_PAD),
      top: Math.max(0, rect.top - SPOTLIGHT_PAD),
      width: rect.width + SPOTLIGHT_PAD * 2,
      height: rect.height + SPOTLIGHT_PAD * 2,
    };
  }, [rect]);

  // Popover positions relative to popoverRect (which may differ from the ring rect).
  const popoverSource = popoverRectProp ?? rect;
  const hole = useMemo(() => {
    if (!popoverSource) return null;
    return {
      left: Math.max(0, popoverSource.left - SPOTLIGHT_PAD),
      top: Math.max(0, popoverSource.top - SPOTLIGHT_PAD),
      width: popoverSource.width + SPOTLIGHT_PAD * 2,
      height: popoverSource.height + SPOTLIGHT_PAD * 2,
    };
  }, [popoverSource]);

  useLayoutEffect(() => {
    const pop = popRef.current;
    if (!pop) return;
    const size = { w: pop.offsetWidth, h: pop.offsetHeight };
    if (!hole) {
      setPopPos({
        x: Math.round((window.innerWidth - size.w) / 2),
        y: Math.round((window.innerHeight - size.h) / 2),
      });
      return;
    }

    const holeCX = hole.left + hole.width / 2;
    const holeCY = hole.top + hole.height / 2;
    const holeBox = { x: hole.left, y: hole.top, w: hole.width, h: hole.height };

    // Prefer the side AWAY from the screen edge the anchor hugs.
    const away: Placement | null =
      holeCX > window.innerWidth * (2 / 3)
        ? "left"
        : holeCX < window.innerWidth / 3
          ? "right"
          : holeCY > window.innerHeight * (2 / 3)
            ? "top"
            : holeCY < window.innerHeight / 3
              ? "bottom"
              : null;

    const candidates = dedupePlacements([
      step.placement,
      away,
      "bottom",
      "right",
      "left",
      "top",
    ]);

    const space = {
      top: hole.top,
      bottom: window.innerHeight - hole.top - hole.height,
      left: hole.left,
      right: window.innerWidth - hole.left - hole.width,
    };

    const fits = (side: Placement) =>
      side === "top" || side === "bottom"
        ? space[side] >= size.h + POPOVER_GAP
        : space[side] >= size.w + POPOVER_GAP;

    const centerX = holeCX - size.w / 2;
    const centerY = holeCY - size.h / 2;

    const rawFor = (side: Placement) => {
      switch (side) {
        case "bottom":
          return { x: centerX, y: hole.top + hole.height + POPOVER_GAP };
        case "top":
          return { x: centerX, y: hole.top - size.h - POPOVER_GAP };
        case "right":
          return { x: hole.left + hole.width + POPOVER_GAP, y: centerY };
        case "left":
          return { x: hole.left - size.w - POPOVER_GAP, y: centerY };
      }
    };

    // First candidate where the clamped popover doesn't intersect the hole.
    for (const side of candidates) {
      if (!fits(side)) continue;
      const clamped = clampToViewport(rawFor(side), size);
      const popBox = { x: clamped.x, y: clamped.y, w: size.w, h: size.h };
      if (!rectsIntersect(popBox, holeBox)) {
        setPopPos(clamped);
        return;
      }
    }

    // Fallback: take the side with the most space, clamp, then slide to clear.
    const bestSide = (Object.entries(space) as [Placement, number][]).sort(
      (a, b) => b[1] - a[1],
    )[0][0];
    const clamped = clampToViewport(rawFor(bestSide), size);
    const popBox = { x: clamped.x, y: clamped.y, w: size.w, h: size.h };

    if (rectsIntersect(popBox, holeBox)) {
      if (bestSide === "top" || bestSide === "bottom") {
        // Slide horizontally to clear.
        if (popBox.x + popBox.w > holeBox.x && popBox.x < holeBox.x) {
          clamped.x = Math.max(8, holeBox.x - popBox.w - POPOVER_GAP / 2);
        } else {
          clamped.x = Math.min(
            window.innerWidth - size.w - 8,
            holeBox.x + holeBox.w + POPOVER_GAP / 2,
          );
        }
      } else {
        // Slide vertically to clear.
        if (popBox.y + popBox.h > holeBox.y && popBox.y < holeBox.y) {
          clamped.y = Math.max(8, holeBox.y - popBox.h - POPOVER_GAP / 2);
        } else {
          clamped.y = Math.min(
            window.innerHeight - size.h - 8,
            holeBox.y + holeBox.h + POPOVER_GAP / 2,
          );
        }
      }
    }
    setPopPos(clamped);
  }, [hole, step.id, step.placement]);

  // Keyboard: Enter/→ advance, ← back.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return;
      }
      if (event.key === "Enter" || event.key === "ArrowRight") {
        event.preventDefault();
        onNext();
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        onBack();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onNext, onBack]);

  const hasAction = Boolean(step.advanceWhen || step.advanceWhenDom);
  const isLast = stepIndex === stepCount - 1;
  const primaryLabel = isLast
    ? "Finish"
    : hasAction && !actionDone
      ? "Skip step →"
      : "Next →";

  return createPortal(
    <div className="tutorial-layer">
      {ringHole ? (
        <div
          className="tutorial-ring"
          style={{ left: ringHole.left, top: ringHole.top, width: ringHole.width, height: ringHole.height }}
        />
      ) : null}
      <div
        ref={popRef}
        className="tutorial-popover"
        role="dialog"
        aria-label={step.title}
        style={popPos ? { left: popPos.x, top: popPos.y } : { visibility: "hidden" }}
      >
        <div className="tutorial-popover-head">
          <span className="tutorial-step-count">
            {stepIndex + 1} / {stepCount}
          </span>
          <h3>{step.title}</h3>
        </div>
        <p className="tutorial-body">{step.body}</p>
        {step.informational ? (
          <p className="tutorial-note">Just so you know — nothing to do here in the sandbox.</p>
        ) : null}
        {hasAction ? (
          <p className={`tutorial-action${actionDone ? " tutorial-action--done" : ""}`}>
            {actionDone
              ? "✓ Nice — click Next when you're done trying it."
              : "Try it now to continue…"}
          </p>
        ) : null}
        <div className="tutorial-dots" aria-hidden="true">
          {Array.from({ length: stepCount }, (_, i) => (
            <span
              key={i}
              className={`tutorial-dot${i === stepIndex ? " tutorial-dot--active" : ""}${i < stepIndex ? " tutorial-dot--past" : ""}`}
            />
          ))}
        </div>
        {confirmingExit ? (
          <div className="tutorial-footer">
            <span className="tutorial-confirm-label">Leave the tutorial? Nothing is saved.</span>
            <button className="btn-ghost" onClick={() => setConfirmingExit(false)}>
              Stay
            </button>
            <button className="btn-danger" onClick={onExit}>
              Leave
            </button>
          </div>
        ) : (
          <div className="tutorial-footer">
            <button className="btn-ghost" disabled={stepIndex === 0} onClick={onBack}>
              ← Back
            </button>
            <button className="btn-ghost tutorial-exit" onClick={() => setConfirmingExit(true)}>
              Exit tour
            </button>
            <button className="btn-primary" onClick={onNext}>
              {primaryLabel}
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
