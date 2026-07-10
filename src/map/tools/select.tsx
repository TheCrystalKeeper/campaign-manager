import { MousePointer2 } from "lucide-react";
import type { MapTool } from "./types";

/// <summary>
/// The default mode: no tool handlers, so the stage pans/zooms and tokens stay
/// clickable/draggable exactly as before tools existed.
/// </summary>
export const selectTool: MapTool = {
  id: "select",
  label: "Select",
  icon: <MousePointer2 size={17} strokeWidth={2.2} />,
  hotkey: "v",
  cursor: "default",
};
