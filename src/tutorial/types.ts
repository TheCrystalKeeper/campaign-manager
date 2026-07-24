import type { GameState, Scene, Viewport } from "../lib/types";
import type { PageId } from "../pages/PageSwitcher";
import type { PanelId } from "../panels/registry";

export type { TutorialMode } from "../lib/tutorialContent";

/**
 * Where a step's spotlight lands: a DOM element (CSS selector), the union rect
 * of all elements matching a selector, a board token (Konva-drawn, no DOM — its
 * screen rect is computed from world coords × the viewport), or nothing
 * (centered popover, no spotlight).
 */
export type TutorialAnchor =
  | { kind: "selector"; selector: string }
  | { kind: "selectorAll"; selector: string }
  | { kind: "token"; tokenId: string }
  | { kind: "center" };

/**
 * Live app state the tutorial can observe. Assembled fresh by App each render;
 * `advanceWhen` predicates compare it against the snapshot taken on step entry.
 */
export type TutorialSignals = {
  page: PageId;
  dockTab: PanelId;
  dockOpen: boolean;
  trayOpen: boolean;
  settingsOpen: boolean;
  openSheetIds: string[];
  openHandoutIds: string[];
  /** The board's effective map tool (select/measure/…), reported by MapCanvas. */
  activeToolId: string;
  /** Bumped on every committed token move. */
  tokenMoves: number;
  selectedTokenIds: string[];
  snap: boolean;
  viewport: Viewport;
  /** The scene THIS client is looking at (multi-scene peek aware). */
  displayedSceneId: string;
  state: GameState;
};

/** UI levers a step's `before` hook may pull to prep the surface it spotlights. */
export type TutorialActions = {
  /** Selects a dock tab and makes sure the dock is expanded. */
  setDockTab: (id: PanelId) => void;
  setDockOpen: (on: boolean) => void;
  setPage: (id: PageId) => void;
  setTrayOpen: (on: boolean) => void;
  openSheet: (sheetId: string) => void;
  /** Closes every open sheet and handout window (tour hygiene between chapters). */
  closeWindows: () => void;
  leave: () => void;
};

export type TutorialStep = {
  id: string;
  anchor: TutorialAnchor;
  title: string;
  body: string;
  /** Preferred popover side relative to the spotlight; auto-picked when omitted. */
  placement?: "top" | "bottom" | "left" | "right";
  /** Position the popover relative to this anchor instead of the ring anchor. */
  popoverAnchor?: TutorialAnchor;
  /** Runs once on step entry (also when re-entered via Back). Must be idempotent. */
  before?: (actions: TutorialActions) => void;
  /** Marks the step's action done (✓ + button relabels to Next). Never auto-advances. */
  advanceWhen?: (sig: TutorialSignals, baseline: TutorialSignals) => boolean;
  /**
   * DOM-side done predicate, evaluated on the anchor poll — for state that
   * lives inside child components (e.g. the sheet window's active page).
   */
  advanceWhenDom?: () => boolean;
  /** Feature can't be demonstrated in the sandbox (needs a second participant). */
  informational?: boolean;
};

// ---- Anchor constructors ------------------------------------------------

export const center: TutorialAnchor = { kind: "center" };

export function sel(selector: string): TutorialAnchor {
  return { kind: "selector", selector };
}

/** Union bounding rect of every element matching `selector` (comma lists OK). */
export function selAll(selector: string): TutorialAnchor {
  return { kind: "selectorAll", selector };
}

export function tokenAnchor(tokenId: string): TutorialAnchor {
  return { kind: "token", tokenId };
}

/** Map-toolbar tool button (MapToolbar stamps data-tool-id per registry entry). */
export function toolAnchor(toolId: string): TutorialAnchor {
  return sel(`[data-tool-id="${toolId}"]`);
}

/** Tool button + its options popup as a union (ring grows when the popup appears). */
export function unionToolAnchor(toolId: string): TutorialAnchor {
  return selAll(`[data-tool-id="${toolId}"], .map-toolbar-options`);
}

/** Dock tab + open panel as a union (ring wraps the whole surface under discussion). */
export function unionDockAnchor(panelId: PanelId): TutorialAnchor {
  return selAll(`[data-dock-tab="${panelId}"], .dock-panel:not(.dock-panel--closed)`);
}

/** Dock panel tab (typed: a removed panel id fails the build in the step file). */
export function dockTabAnchor(panelId: PanelId): TutorialAnchor {
  return sel(`[data-dock-tab="${panelId}"]`);
}

/** Dock action button: character sheet / dice tray / settings. */
export function dockActionAnchor(id: "sheet" | "dice" | "settings"): TutorialAnchor {
  return sel(`[data-dock-action="${id}"]`);
}

/** Page-switcher button (typed against PageId). */
export function pageAnchor(pageId: PageId): TutorialAnchor {
  return sel(`[data-page-id="${pageId}"]`);
}

/** Character-sheet rail page button. */
export function sheetPageAnchor(pageId: string): TutorialAnchor {
  return sel(`[data-sheet-page="${pageId}"]`);
}

// ---- Shared advance predicates ------------------------------------------

export function viewportMoved(sig: TutorialSignals, base: TutorialSignals): boolean {
  return (
    sig.viewport.x !== base.viewport.x ||
    sig.viewport.y !== base.viewport.y ||
    sig.viewport.scale !== base.viewport.scale
  );
}

/** Id of the newest roll entry in the log, or null. */
export function lastRollId(state: GameState): string | null {
  for (let i = state.log.length - 1; i >= 0; i--) {
    const entry = state.log[i];
    if (entry.kind === "roll") return entry.id;
  }
  return null;
}

/** True once any dice roll (3D throw, sheet check, or typed expression) lands in the log. */
export function rolledSinceBaseline(sig: TutorialSignals, base: TutorialSignals): boolean {
  const latest = lastRollId(sig.state);
  return latest !== null && latest !== lastRollId(base.state);
}

/** The scene this client is currently displaying (falls back to the live scene). */
export function displayedScene(sig: TutorialSignals): Scene | null {
  return sig.state.scenes.find((scene) => scene.id === sig.displayedSceneId) ?? null;
}

/** True while a DOM element matching `selector` exists — for advanceWhenDom. */
export function domExists(selector: string): boolean {
  return Boolean(document.querySelector(selector));
}

/** Freehand strokes on the displayed scene (template shapes excluded). */
export function strokesGrew(sig: TutorialSignals, base: TutorialSignals): boolean {
  const count = (s: TutorialSignals) =>
    (displayedScene(s)?.annotations ?? []).filter(
      (a) => a.kind === "stroke" && a.origin !== "template",
    ).length;
  return count(sig) > count(base);
}

/** Pin annotations grew on the displayed scene. */
export function pinsGrew(sig: TutorialSignals, base: TutorialSignals): boolean {
  const count = (s: TutorialSignals) =>
    (displayedScene(s)?.annotations ?? []).filter((a) => a.kind === "pin").length;
  return count(sig) > count(base);
}

/** Grid calibration (size or offset) changed on the displayed scene. */
export function gridCalibrationChanged(sig: TutorialSignals, base: TutorialSignals): boolean {
  const cur = displayedScene(sig);
  const was = displayedScene(base);
  return (
    !!cur &&
    !!was &&
    (cur.gridSize !== was.gridSize ||
      cur.gridOffsetX !== was.gridOffsetX ||
      cur.gridOffsetY !== was.gridOffsetY)
  );
}

/** Any sheet window opened since step entry. */
export function sheetOpened(sig: TutorialSignals, base: TutorialSignals): boolean {
  return sig.openSheetIds.length > base.openSheetIds.length;
}
