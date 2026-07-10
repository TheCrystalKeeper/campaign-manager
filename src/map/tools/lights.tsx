import { Lamp } from "lucide-react";
import type { Light } from "../../lib/types";
import type { MapTool } from "./types";

/// <summary>
/// Lights tool (DM, Phase 6): click the map to drop a light source (default 20ft bright
/// / 40ft dim). Lights illuminate for players when the scene's global illumination is
/// off. Moving/removing/retuning a light happens on the rendered light markers
/// (handled in MapCanvas), not through this tool.
/// </summary>

/**
 * Named light presets offered by the toolbar. Beyond bright/dim radii (feet) each seeds
 * sensible Phase 6.6 atmosphere: warm fire-light flickers, a lantern is steady & neutral.
 */
export const LIGHT_PRESETS = {
  candle: {
    brightR: 5,
    dimR: 10,
    color: "#ffb765",
    colorIntensity: 0.5,
    animation: { type: "flicker", speed: 0.8, intensity: 0.35 },
  },
  torch: {
    brightR: 20,
    dimR: 40,
    color: "#ff9d5c",
    colorIntensity: 0.5,
    animation: { type: "flicker", speed: 1, intensity: 0.5 },
  },
  lantern: {
    brightR: 30,
    dimR: 60,
    color: "#ffd9a0",
    colorIntensity: 0.35,
  },
} as const;

export type LightPreset = keyof typeof LIGHT_PRESETS;

export const lightsTool: MapTool = {
  id: "lights",
  label: "Lights",
  icon: <Lamp size={17} strokeWidth={2.2} />,
  hotkey: "l",
  dmOnly: true,
  cursor: "crosshair",
  onDown: (event, rt) => {
    const light: Light = {
      ...rt.lightRadii,
      id: `light-${crypto.randomUUID().slice(0, 8)}`,
      x: event.world.x,
      y: event.world.y,
      enabled: true,
    };
    rt.send({ type: "ADD_LIGHT", sceneId: rt.scene.id, light });
  },
};
