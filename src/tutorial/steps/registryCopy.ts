import { MAP_TOOLS } from "../../map/tools/registry";
import { PANELS, type PanelId } from "../../panels/registry";

/**
 * Step copy pulls live labels/hotkeys/descriptions from the two feature
 * registries instead of duplicating the text — rename a tool or change its
 * hotkey and the tutorial says the new thing with zero edits here.
 */

export function toolTitle(toolId: string): string {
  const tool = MAP_TOOLS.find((item) => item.id === toolId);
  if (!tool) return toolId;
  return `${tool.label} (${tool.hotkey.toUpperCase()})`;
}

export function toolTip(toolId: string): string {
  return MAP_TOOLS.find((item) => item.id === toolId)?.tipDesc ?? "";
}

export function panelLabel(panelId: PanelId): string {
  return PANELS.find((item) => item.id === panelId)?.label ?? panelId;
}

export function panelTip(panelId: PanelId): string {
  return PANELS.find((item) => item.id === panelId)?.tipDesc ?? "";
}
