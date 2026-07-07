import type { ReactNode } from "react";
import type { ClientMessage, FogShape, Light, Scene, TemplateKind, WallBrush } from "../../lib/types";

/// <summary>
/// The plug-in interface every map tool implements (Phase 5 architecture; Phase 6
/// walls/lights reuse it). MapCanvas owns one active tool and routes stage pointer
/// events to it; the tool keeps transient in-progress state in `draft` and renders it
/// via `renderDraft` (react-konva nodes). Committing work = sending a room message.
/// </summary>

export type ToolPoint = { x: number; y: number };

/**
 * How the calibrate tool interprets a drag:
 *  - "adjust" — the direct-manipulation gizmo: drag a reference-cell CORNER to resize, drag
 *    anywhere else to move the grid. Move + resize with no mode switching.
 *  - "box"    — drag a fresh box over one map square to set size + offset from scratch.
 */
export type CalibrateMode = "adjust" | "box";

export type ToolPointerEvent = {
  /** Pointer position in map/world coordinates (through the stage transform). */
  world: ToolPoint;
  shiftKey: boolean;
};

/** Everything a tool needs from the canvas shell. */
export type ToolRuntime = {
  scene: Scene;
  isDm: boolean;
  yourPlayerId: string | null;
  send: (message: ClientMessage) => void;
  /** The active tool's transient state; cleared on tool switch. */
  draft: unknown;
  setDraft: (draft: unknown) => void;
  drawColor: string;
  drawWidth: number;
  /** Per-client snap-to-grid (walls snap endpoints to grid intersections when on). */
  snap: boolean;
  /** Fog brush: paint direction (reveal cuts fog, cover paints it back). */
  fogMode: "reveal" | "cover";
  /** Fog brush radius in world px (already grid-scaled by MapCanvas). */
  fogBrushR: number;
  /** Fog tool: freehand brush vs a rectangle / lasso / polygon-lasso area selection. */
  fogShape: FogShape;
  /** Walls tool: what a fresh segment is drawn as (channel preset or a door). */
  wallBrush: WallBrush;
  /** Snap a world point to a nearby wall endpoint, else micro/grid snap (`free` = Shift-precise). */
  snapWallPoint: (x: number, y: number, opts?: { excludeId?: string; free?: boolean }) => ToolPoint;
  /** Lights tool: the preset a freshly placed light gets (radii in feet + Phase 6.6 style). */
  lightRadii: Omit<Light, "id" | "x" | "y" | "enabled">;
  /** Templates tool: which area shape to draw. */
  templateKind: TemplateKind;
  /** Templates tool: pin the shape as a persistent annotation instead of a fading relay. */
  templatePin: boolean;
  /** Calibrate tool: the direct-manipulation "adjust" mode, or the box-a-cell gesture. */
  calibrateMode: CalibrateMode;
  /**
   * Live viewport scale (world px → screen px). Lets tools size hit-thresholds and draw handles at
   * a consistent SCREEN size regardless of zoom — used by the calibrate "adjust" grid-point handles.
   */
  viewportScale: number;
};

export type MapTool = {
  id: string;
  label: string;
  icon: string;
  hotkey: string;
  dmOnly?: boolean;
  cursor: string;
  onDown?: (event: ToolPointerEvent, rt: ToolRuntime) => void;
  onMove?: (event: ToolPointerEvent, rt: ToolRuntime) => void;
  onUp?: (event: ToolPointerEvent, rt: ToolRuntime) => void;
  /** Double-click (e.g. finish a polygon-lasso selection). */
  onDblClick?: (event: ToolPointerEvent, rt: ToolRuntime) => void;
  /** Pointer left the stage — clear hover-only previews (mid-drag drafts should survive). */
  onLeave?: (rt: ToolRuntime) => void;
  /** Konva nodes visualizing the in-progress draft. */
  renderDraft?: (draft: unknown, rt: ToolRuntime) => ReactNode;
};
