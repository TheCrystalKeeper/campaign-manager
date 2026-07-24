import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { isHoverTooltipsEnabled, subscribeHoverTooltips } from "../lib/hoverTooltips";

/// <summary>
/// Global hover-tooltip layer: one component, mounted once beside &lt;App /&gt;, that upgrades every
/// native `title=` hint in the app to an instant, parchment-styled bubble. It listens for
/// pointerover on the document, stashes the hovered element's `title` into `data-cm-title` (so
/// the browser bubble never fires) and restores it on leave. With the "Hover tooltips" setting
/// off it goes inert, leaving native titles untouched. Contract and design notes: TOOLTIPS.md.
/// </summary>

const SHOW_DELAY = 300;
/** After a bubble hides, re-shows within this window skip the delay (native-toolbar feel). */
const GRACE = 500;
/** Gap between the anchor and the bubble, and the minimum margin to the viewport edge. */
const GAP = 8;
const MARGIN = 8;
/** Where a hovered element's `title` is stashed while our bubble owns the hover. */
const STASH = "data-cm-title";

type Side = "top" | "bottom" | "left" | "right";

type Tip = {
  anchor: HTMLElement;
  label: string;
  kbd: string | null;
  desc: string | null;
  side: Side;
};

const SIDES: readonly Side[] = ["top", "bottom", "left", "right"];
const MODIFIERS = new Set(["Ctrl", "Alt", "Shift", "⌘", "⌥", "⇧"]);
const NAMED_KEY =
  /^(F\d{1,2}|Space|Esc|Escape|Enter|Tab|Del|Delete|Backspace|Home|End|PageUp|PageDown|[←→↑↓])$/;

/**
 * Split a trailing " (chord)" keybind off a title, e.g. "Measure (M)" or "Undo (Ctrl+Z)".
 * Only captures that look like formatBinding output become chips — modifiers joined by "+"
 * ending in a single character, arrow, F-key, or named key — so parentheticals like
 * "(popped out)" render verbatim in the label instead.
 */
function splitKeybind(title: string): { label: string; kbd: string | null } {
  const match = /^(.*\S)\s\(([^()]{1,24})\)$/.exec(title);
  if (match) {
    const parts = match[2].split("+");
    const key = parts.pop() ?? "";
    const keyOk = key.length === 1 || NAMED_KEY.test(key);
    if (keyOk && parts.every((part) => MODIFIERS.has(part))) {
      return { label: match[1], kbd: match[2] };
    }
  }
  return { label: title, kbd: null };
}

/** Move an element's `title` into the stash attribute so the native bubble can't appear. */
function stashTitle(anchor: HTMLElement) {
  const title = anchor.getAttribute("title");
  if (title !== null) {
    anchor.setAttribute(STASH, title);
    anchor.removeAttribute("title");
  }
}

/** Undo stashTitle. Skipped for disconnected nodes — a remount carries its own fresh title. */
function restoreTitle(anchor: HTMLElement) {
  const stashed = anchor.getAttribute(STASH);
  if (stashed !== null) {
    if (anchor.isConnected && !anchor.hasAttribute("title")) {
      anchor.setAttribute("title", stashed);
    }
    anchor.removeAttribute(STASH);
  }
}

/** Restore every stash in the document — run when the layer unmounts or is toggled off. */
function restoreAllTitles() {
  for (const el of document.querySelectorAll(`[${STASH}]`)) {
    restoreTitle(el as HTMLElement);
  }
}

export function TooltipLayer() {
  const [tip, setTip] = useState<Tip | null>(null);
  const [shown, setShown] = useState(false);
  const tipRef = useRef<HTMLDivElement | null>(null);

  // Hover bookkeeping lives in refs — nothing re-renders until a bubble actually shows.
  const anchorRef = useRef<HTMLElement | null>(null);
  const timerRef = useRef<number | null>(null);
  const graceUntilRef = useRef(0);
  const observerRef = useRef<MutationObserver | null>(null);
  const visibleForRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const clearTimer = () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };

    /** Drop the bubble (and any pending show) but keep the stash — we're still hovering. */
    const hideBubble = () => {
      clearTimer();
      if (visibleForRef.current) {
        graceUntilRef.current = Date.now() + GRACE;
        visibleForRef.current = null;
      }
      setTip(null);
      setShown(false);
    };

    const show = () => {
      const anchor = anchorRef.current;
      if (!anchor || !anchor.isConnected) return;
      const raw = anchor.getAttribute(STASH) ?? "";
      const desc = anchor.getAttribute("data-tip-desc");
      if (!raw && !desc) return;
      const { label, kbd } = splitKeybind(raw);
      const sideAttr = anchor.closest("[data-tip-side]")?.getAttribute("data-tip-side");
      const side = SIDES.includes(sideAttr as Side) ? (sideAttr as Side) : "top";
      const firstShow = visibleForRef.current !== anchor;
      visibleForRef.current = anchor;
      setTip({ anchor, label, kbd, desc, side });
      // Live text updates keep the bubble opaque; only a fresh show restarts the fade.
      if (firstShow) setShown(false);
    };

    /** Fully release the current anchor: cancel, restore its title, drop the bubble. */
    const leave = () => {
      clearTimer();
      observerRef.current?.disconnect();
      observerRef.current = null;
      if (anchorRef.current) {
        restoreTitle(anchorRef.current);
        anchorRef.current = null;
      }
      hideBubble();
    };

    const enter = (anchor: HTMLElement) => {
      leave();
      anchorRef.current = anchor;
      stashTitle(anchor);
      if (!anchor.getAttribute(STASH) && !anchor.getAttribute("data-tip-desc")) {
        // Empty title and no description — nothing to say. Put the (empty) title back.
        restoreTitle(anchor);
        anchorRef.current = null;
        return;
      }
      // React re-sets `title` when its VALUE changes mid-hover (snap on/off, mute…):
      // immediately re-stash so the native bubble stays suppressed, and refresh live text.
      const observer = new MutationObserver(() => {
        if (anchorRef.current !== anchor) return;
        stashTitle(anchor);
        if (visibleForRef.current === anchor) show();
      });
      observer.observe(anchor, { attributes: true, attributeFilter: ["title"] });
      observerRef.current = observer;
      if (Date.now() < graceUntilRef.current) {
        show();
      } else {
        timerRef.current = window.setTimeout(show, SHOW_DELAY);
      }
    };

    const onPointerOver = (event: PointerEvent) => {
      if (event.pointerType === "touch") return;
      if (!isHoverTooltipsEnabled()) return;
      if (event.buttons !== 0) return; // mid-drag sweep — stay quiet
      const target = event.target instanceof Element ? event.target : null;
      let candidate = target?.closest<HTMLElement>(`[title], [${STASH}]`) ?? null;
      if (candidate?.closest("[data-no-tip]")) candidate = null;
      if (candidate === anchorRef.current) return;
      if (candidate) enter(candidate);
      else leave();
    };

    const onPointerOut = (event: PointerEvent) => {
      if (event.pointerType === "touch") return;
      const anchor = anchorRef.current;
      if (!anchor) return;
      const related = event.relatedTarget instanceof Node ? event.relatedTarget : null;
      if (related && anchor.contains(related)) return; // crossed an inner boundary
      leave();
    };

    const onPointerDown = () => hideBubble();

    const onPointerUp = (event: PointerEvent) => {
      // Released on the control we're still hovering: re-arm, so toggles show fresh text.
      const anchor = anchorRef.current;
      if (!anchor || !(event.target instanceof Node) || !anchor.contains(event.target)) return;
      clearTimer();
      timerRef.current = window.setTimeout(show, SHOW_DELAY);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") hideBubble();
    };
    // Scroll, drag, resize: the anchor's rect is (or is about to be) stale — drop the bubble.
    const onViewportChange = () => hideBubble();
    const onBlur = () => leave(); // pointer state is unknown when the window refocuses

    document.addEventListener("pointerover", onPointerOver);
    document.addEventListener("pointerout", onPointerOut);
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("pointerup", onPointerUp, true);
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("scroll", onViewportChange, { capture: true, passive: true });
    document.addEventListener("dragstart", onViewportChange, true);
    window.addEventListener("resize", onViewportChange);
    window.addEventListener("blur", onBlur);
    const unsubscribe = subscribeHoverTooltips((on) => {
      if (!on) {
        leave();
        restoreAllTitles();
      }
    });

    return () => {
      document.removeEventListener("pointerover", onPointerOver);
      document.removeEventListener("pointerout", onPointerOut);
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("pointerup", onPointerUp, true);
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("scroll", onViewportChange, { capture: true });
      document.removeEventListener("dragstart", onViewportChange, true);
      window.removeEventListener("resize", onViewportChange);
      window.removeEventListener("blur", onBlur);
      unsubscribe();
      leave();
      restoreAllTitles();
    };
  }, []);

  // Position the bubble against its anchor, flip on viewport overflow, clamp, then fade in.
  useLayoutEffect(() => {
    if (!tip) return;
    const el = tipRef.current;
    const anchor = tip.anchor;
    if (!el || !anchor.isConnected) return;
    const a = anchor.getBoundingClientRect();
    const t = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let side = tip.side;
    if (side === "top" && a.top - GAP - t.height < MARGIN) side = "bottom";
    else if (side === "bottom" && a.bottom + GAP + t.height > vh - MARGIN) side = "top";
    else if (side === "right" && a.right + GAP + t.width > vw - MARGIN) side = "left";
    else if (side === "left" && a.left - GAP - t.width < MARGIN) side = "right";
    let x: number;
    let y: number;
    if (side === "top" || side === "bottom") {
      x = a.left + a.width / 2 - t.width / 2;
      y = side === "top" ? a.top - GAP - t.height : a.bottom + GAP;
    } else {
      x = side === "right" ? a.right + GAP : a.left - GAP - t.width;
      y = a.top + a.height / 2 - t.height / 2;
    }
    x = Math.min(Math.max(x, MARGIN), vw - MARGIN - t.width);
    y = Math.min(Math.max(y, MARGIN), vh - MARGIN - t.height);
    el.style.left = `${Math.round(x)}px`;
    el.style.top = `${Math.round(y)}px`;
    const raf = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(raf);
  }, [tip]);

  if (!tip) return null;
  return createPortal(
    <div ref={tipRef} role="tooltip" className={`cm-tip${shown ? " cm-tip--visible" : ""}`}>
      {tip.label ? (
        <div className="cm-tip__label">
          {tip.label}
          {tip.kbd ? <span className="cm-tip__kbd">{tip.kbd}</span> : null}
        </div>
      ) : null}
      {tip.desc ? <div className="cm-tip__desc">{tip.desc}</div> : null}
    </div>,
    document.body,
  );
}
