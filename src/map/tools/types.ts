import type { ReactNode } from "react";
import type { ClientMessage, Light, Scene } from "../../lib/types";

/// <summary>
/// The plug-in interface every map tool implements (Phase 5 architecture; Phase 6
/// walls/lights reuse it). MapCanvas owns one active tool and routes stage pointer
/// events to it; the tool keeps transient in-progress state in `draft` and renders it
/// via `renderDraft` (react-konva nodes). Committing work = sending a room message.
/// </summary>

export type ToolPoint = { x: number; y: number };

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
  /** Walls tool: what a plain drag draws (Shift always forces the other kind). */
  wallKind: "wall" | "door";
  /** Lights tool: the preset a freshly placed light gets (radii in feet + Phase 6.6 style). */
  lightRadii: Omit<Light, "id" | "x" | "y" | "enabled">;
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
  /** Pointer left the stage — clear hover-only previews (mid-drag drafts should survive). */
  onLeave?: (rt: ToolRuntime) => void;
  /** Konva nodes visualizing the in-progress draft. */
  renderDraft?: (draft: unknown, rt: ToolRuntime) => ReactNode;
};
