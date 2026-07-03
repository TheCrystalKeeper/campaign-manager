import { selectTool } from "./select";
import { measureTool } from "./measure";
import { drawTool } from "./draw";
import { calibrateTool } from "./calibrate";
import { fogTool } from "./fog";
import { wallsTool } from "./walls";
import { lightsTool } from "./lights";
import type { MapTool } from "./types";

/// <summary>
/// The map tool registry: one entry per tool module (same pattern as the panel
/// registry). Adding a tool = one module + one entry here.
/// </summary>
export const MAP_TOOLS: MapTool[] = [
  selectTool,
  measureTool,
  drawTool,
  calibrateTool,
  fogTool,
  wallsTool,
  lightsTool,
];

export function toolsForRole(isDm: boolean): MapTool[] {
  return MAP_TOOLS.filter((tool) => !tool.dmOnly || isDm);
}
