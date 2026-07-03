import type { ReactNode } from "react";
import type { ClientMessage, Scene } from "../../lib/types";

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
  /** Konva nodes visualizing the in-progress draft. */
  renderDraft?: (draft: unknown, rt: ToolRuntime) => ReactNode;
};
