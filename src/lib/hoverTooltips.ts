import { useState } from "react";
import { readLocalFlag, writeLocalFlag } from "./localFlags";

/// <summary>
/// Client-local "hover tooltips" preference (per browser — NOT synced to the room). When on
/// (the default), TooltipLayer replaces native `title` bubbles with instant, parchment-styled
/// ones. When off, the layer goes inert and the browser's plain native tooltips take over —
/// no information is lost. See TOOLTIPS.md for the full contract.
/// </summary>
const KEY = "cm-hover-tooltips";

/** Change listeners — TooltipLayer subscribes so flipping the toggle tears it down instantly. */
const listeners = new Set<(on: boolean) => void>();

export function isHoverTooltipsEnabled(): boolean {
  return readLocalFlag(KEY, true);
}

export function setHoverTooltipsEnabled(on: boolean): void {
  writeLocalFlag(KEY, on);
  for (const listener of listeners) listener(on);
}

export function subscribeHoverTooltips(listener: (on: boolean) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/// <summary>React state hook backing the Settings toggle.</summary>
export function useHoverTooltips(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(isHoverTooltipsEnabled);
  return [
    on,
    (value: boolean) => {
      setHoverTooltipsEnabled(value);
      setOn(value);
    },
  ];
}
