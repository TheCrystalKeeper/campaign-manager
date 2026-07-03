/// <summary>
/// Shared "never lose a floating element" helpers (cross-phase engineering rule #7):
/// every draggable floating UI element (windows, dice tray, future) clamps FULLY
/// on-screen — measured size + margin — on load, drag, and resize, and provides a
/// reset affordance. A movable element the user can strand off-screen is a bug.
/// </summary>

export type ViewportPos = { x: number; y: number };
export type ViewportSize = { w: number; h: number };

export const CLAMP_MARGIN = 8;

/// <summary>
/// Keeps the WHOLE element (its measured size plus a margin) inside the window.
/// When the element is bigger than the window, it pins to the top/left margin so
/// the title bar / controls stay reachable.
/// </summary>
export function clampToViewport(
  pos: ViewportPos,
  size: ViewportSize,
  margin: number = CLAMP_MARGIN,
): ViewportPos {
  const maxX = Math.max(margin, window.innerWidth - size.w - margin);
  const maxY = Math.max(margin, window.innerHeight - size.h - margin);
  return {
    x: Math.min(Math.max(pos.x, margin), maxX),
    y: Math.min(Math.max(pos.y, margin), maxY),
  };
}

/// <summary>Shrinks a size so the element can fit on-screen with the margin (small screens).</summary>
export function clampSizeToViewport(
  size: ViewportSize,
  margin: number = CLAMP_MARGIN,
): ViewportSize {
  return {
    w: Math.min(size.w, Math.max(1, window.innerWidth - margin * 2)),
    h: Math.min(size.h, Math.max(1, window.innerHeight - margin * 2)),
  };
}
