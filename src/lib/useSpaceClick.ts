import { useEffect } from "react";
import { useKeybinds } from "./useKeybinds";
import { physicalKey } from "./keybinds";

/** True when a keyboard event targets an editable field (so Space types a space there). */
function isTypingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

/** A stable synthetic pointer id for the "space button" so nothing mistakes it for touch. */
const SPACE_POINTER_ID = 9001;
/** Movement past this (px) between press and release counts as a drag, so no click fires. */
const CLICK_MOVE_SLOP = 6;

type Mods = { shiftKey: boolean; ctrlKey: boolean; altKey: boolean; metaKey: boolean };

/// <summary>
/// When enabled, holding the SpaceBar behaves like holding the physical left mouse button
/// at the current cursor position: press → pointerdown/mousedown, release → pointerup/mouseup
/// (plus a click if the cursor barely moved). Real cursor moves in between drive drags, so a
/// press-move-release becomes a click-drag. Built for touchpad users who struggle to hold a
/// physical click. Opt-in via the "SpaceBar = left click" setting.
///
/// It synthesizes both PointerEvents and MouseEvents so it works with everything the app
/// listens to (Konva board/token drags, React onClick handlers, window-level drag listeners).
/// Space in a text field still types a space; Ctrl/Alt/Meta+Space pass through untouched.
/// </summary>
export function useSpaceClick(enabled: boolean) {
  // The trigger key is rebindable (default Space) via the Keybinds settings page.
  const triggerKey = useKeybinds().spaceClick.key;
  useEffect(() => {
    if (!enabled) {
      return;
    }

    // Last known cursor position — drives where the synthetic click lands.
    let lastX = window.innerWidth / 2;
    let lastY = window.innerHeight / 2;
    // Where the press started, to tell a click from a drag.
    let downX = 0;
    let downY = 0;
    // Whether the space "button" is currently held down (guards key-repeat + stuck keys).
    let held = false;

    const track = (event: PointerEvent | MouseEvent) => {
      lastX = event.clientX;
      lastY = event.clientY;
    };

    /** Dispatches one synthetic event of each requested kind at (x, y) to the element there. */
    const dispatchAt = (
      x: number,
      y: number,
      kinds: Array<{ pointer: boolean; type: string }>,
      buttons: number,
      mods: Mods,
    ) => {
      const target = document.elementFromPoint(x, y) ?? document.body;
      const base = {
        bubbles: true,
        cancelable: true,
        composed: true,
        view: window,
        clientX: x,
        clientY: y,
        screenX: x,
        screenY: y,
        button: 0,
        buttons,
        ...mods,
      };
      for (const kind of kinds) {
        const event = kind.pointer
          ? new PointerEvent(kind.type, {
              ...base,
              pointerId: SPACE_POINTER_ID,
              pointerType: "mouse",
              isPrimary: true,
            })
          : new MouseEvent(kind.type, base);
        try {
          target.dispatchEvent(event);
        } catch {
          // A handler (e.g. setPointerCapture on a synthetic pointer) may throw; ignore it
          // so one uncooperative target can't wedge the whole gesture.
        }
      }
    };

    const press = (mods: Mods) => {
      held = true;
      downX = lastX;
      downY = lastY;
      dispatchAt(
        lastX,
        lastY,
        [
          { pointer: true, type: "pointerdown" },
          { pointer: false, type: "mousedown" },
        ],
        1,
        mods,
      );
    };

    const release = (mods: Mods) => {
      if (!held) {
        return;
      }
      held = false;
      dispatchAt(
        lastX,
        lastY,
        [
          { pointer: true, type: "pointerup" },
          { pointer: false, type: "mouseup" },
        ],
        0,
        mods,
      );
      // A real left click only fires when the pointer didn't wander between down and up.
      if (Math.hypot(lastX - downX, lastY - downY) <= CLICK_MOVE_SLOP) {
        dispatchAt(lastX, lastY, [{ pointer: false, type: "click" }], 0, mods);
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (physicalKey(event) !== triggerKey) {
        return;
      }
      // Leave the key alone while typing, and let OS/app combos (Ctrl/Alt/Meta+key) pass.
      if (isTypingTarget(event.target) || event.ctrlKey || event.altKey || event.metaKey) {
        return;
      }
      // Own the key: stop page scroll and the default "activate the focused button" behavior,
      // and keep other Space handlers from also firing.
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.repeat || held) {
        return;
      }
      press({ shiftKey: event.shiftKey, ctrlKey: false, altKey: false, metaKey: false });
    };

    const onKeyUp = (event: KeyboardEvent) => {
      if (physicalKey(event) !== triggerKey) {
        return;
      }
      if (!held) {
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      release({ shiftKey: event.shiftKey, ctrlKey: false, altKey: false, metaKey: false });
    };

    // If focus leaves the window mid-hold, release so the button never sticks.
    const onBlur = () => release({ shiftKey: false, ctrlKey: false, altKey: false, metaKey: false });

    window.addEventListener("pointermove", track, { passive: true });
    window.addEventListener("mousemove", track, { passive: true });
    // Capture phase so we preempt (and can suppress) any other Space handlers.
    window.addEventListener("keydown", onKeyDown, { capture: true });
    window.addEventListener("keyup", onKeyUp, { capture: true });
    window.addEventListener("blur", onBlur);

    return () => {
      if (held) {
        release({ shiftKey: false, ctrlKey: false, altKey: false, metaKey: false });
      }
      window.removeEventListener("pointermove", track);
      window.removeEventListener("mousemove", track);
      window.removeEventListener("keydown", onKeyDown, { capture: true });
      window.removeEventListener("keyup", onKeyUp, { capture: true });
      window.removeEventListener("blur", onBlur);
    };
  }, [enabled, triggerKey]);
}
