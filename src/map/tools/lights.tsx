import type { Light } from "../../lib/types";
import type { MapTool } from "./types";

/// <summary>
/// Lights tool (DM, Phase 6): click the map to drop a light source (default 20ft bright
/// / 40ft dim). Lights illuminate for players when the scene's global illumination is
/// off. Moving/removing/retuning a light happens on the rendered light markers
/// (handled in MapCanvas), not through this tool.
/// </summary>

/** Named light presets (bright / dim feet) offered by the toolbar. */
export const LIGHT_PRESETS = {
  candle: { brightR: 5, dimR: 10 },
  torch: { brightR: 20, dimR: 40 },
  lantern: { brightR: 30, dimR: 60 },
} as const;

export type LightPreset = keyof typeof LIGHT_PRESETS;

export const lightsTool: MapTool = {
  id: "lights",
  label: "Lights",
  icon: "💡",
  hotkey: "l",
  dmOnly: true,
  cursor: "crosshair",
  onDown: (event, rt) => {
    const light: Light = {
      id: `light-${crypto.randomUUID().slice(0, 8)}`,
      x: event.world.x,
      y: event.world.y,
      brightR: rt.lightRadii.brightR,
      dimR: rt.lightRadii.dimR,
      enabled: true,
    };
    rt.send({ type: "ADD_LIGHT", sceneId: rt.scene.id, light });
  },
};
