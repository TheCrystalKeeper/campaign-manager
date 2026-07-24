import { useEffect, useRef, useState } from "react";
import { DEFAULT_TOKEN_SIZE } from "../lib/types";
import type { TutorialAnchor, TutorialSignals } from "./types";

export type AnchorRect = { left: number; top: number; width: number; height: number };

/** Poll cadence for selector re-measures and advanceWhenDom (dock/window animations). */
export const TUTORIAL_POLL_MS = 250;

function rectsDiffer(a: AnchorRect | null, b: AnchorRect | null): boolean {
  if (!a || !b) return a !== b;
  return (
    Math.abs(a.left - b.left) > 0.5 ||
    Math.abs(a.top - b.top) > 0.5 ||
    Math.abs(a.width - b.width) > 0.5 ||
    Math.abs(a.height - b.height) > 0.5
  );
}

function measureSelector(selector: string): AnchorRect | null {
  const el = document.querySelector(selector);
  if (!el) return null;
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return null;
  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
}

/** Union bounding rect of every match (comma-list selectors supported). */
function measureSelectorAll(selector: string): AnchorRect | null {
  const els = document.querySelectorAll(selector);
  let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
  let found = false;
  els.forEach((el) => {
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return;
    found = true;
    l = Math.min(l, rect.left);
    t = Math.min(t, rect.top);
    r = Math.max(r, rect.right);
    b = Math.max(b, rect.bottom);
  });
  return found ? { left: l, top: t, width: r - l, height: b - t } : null;
}

/** World→screen: the Konva stage renders at screen = viewport.{x,y} + world × scale. */
function measureToken(tokenId: string, signals: TutorialSignals): AnchorRect | null {
  const token = signals.state.tokens.find((item) => item.id === tokenId);
  if (!token || token.sceneId !== signals.displayedSceneId) return null;
  const scene = signals.state.scenes.find((item) => item.id === token.sceneId);
  if (!scene) return null;
  const vp = signals.viewport;
  const cells = token.size ?? signals.state.defaultTokenSize ?? DEFAULT_TOKEN_SIZE;
  const radius = (scene.gridSize * cells * vp.scale) / 2;
  const cx = vp.x + token.x * vp.scale;
  const cy = vp.y + token.y * vp.scale;
  if (
    cx + radius < 0 ||
    cy + radius < 0 ||
    cx - radius > window.innerWidth ||
    cy - radius > window.innerHeight
  ) {
    return null;
  }
  return { left: cx - radius, top: cy - radius, width: radius * 2, height: radius * 2 };
}

/**
 * One-shot scroll-into-view for anchors inside scrollable containers (e.g. the
 * token editor's `.panel-body`). Fires once per step on the first successful
 * element find; doesn't fight the user's own scrolling afterwards.
 */
function scrollIntoViewOnce(selector: string, scrolledRef: React.MutableRefObject<boolean>) {
  if (scrolledRef.current) return;
  const el = document.querySelector(selector);
  if (!el) return;
  scrolledRef.current = true;
  el.scrollIntoView({ block: "nearest" });
}

/**
 * The current screen rect of a step's anchor, or null (→ centered popover).
 * Selector anchors re-measure on resize plus a slow poll — cheap, and it also
 * tracks dock open/close animations and dragged floating windows without
 * wiring observers into every surface. Token anchors re-measure on every
 * render via the viewport/state dependencies.
 */
export function useAnchorRect(
  anchor: TutorialAnchor,
  signals: TutorialSignals,
): AnchorRect | null {
  const [rect, setRect] = useState<AnchorRect | null>(null);
  const signalsRef = useRef(signals);
  signalsRef.current = signals;
  const scrolledRef = useRef(false);

  useEffect(() => {
    scrolledRef.current = false;
  }, [anchor]);

  useEffect(() => {
    if (anchor.kind === "center") {
      setRect(null);
      return;
    }
    const measure = () => {
      let next: AnchorRect | null;
      if (anchor.kind === "token") {
        next = measureToken(anchor.tokenId, signalsRef.current);
      } else if (anchor.kind === "selectorAll") {
        scrollIntoViewOnce(anchor.selector.split(",")[0].trim(), scrolledRef);
        next = measureSelectorAll(anchor.selector);
      } else {
        scrollIntoViewOnce(anchor.selector, scrolledRef);
        next = measureSelector(anchor.selector);
      }
      setRect((current) => (rectsDiffer(current, next) ? next : current));
    };
    measure();
    const interval = window.setInterval(measure, TUTORIAL_POLL_MS);
    window.addEventListener("resize", measure);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("resize", measure);
    };
  }, [anchor]);

  // Token rects follow every pan/zoom/move immediately (no poll lag).
  useEffect(() => {
    if (anchor.kind !== "token") return;
    const next = measureToken(anchor.tokenId, signals);
    setRect((current) => (rectsDiffer(current, next) ? next : current));
  }, [anchor, signals]);

  return rect;
}
