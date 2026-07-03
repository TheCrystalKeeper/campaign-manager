import type { MapTool } from "./types";

/// <summary>
/// The default mode: no tool handlers, so the stage pans/zooms and tokens stay
/// clickable/draggable exactly as before tools existed.
/// </summary>
export const selectTool: MapTool = {
  id: "select",
  label: "Select",
  icon: "🖱",
  hotkey: "v",
  cursor: "default",
};
