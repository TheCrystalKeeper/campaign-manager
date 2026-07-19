import type { PlayerSlot } from "../../lib/types";

/**
 * Per-player-slot chart series colors (CSS vars so day/night themes swap
 * automatically). Same slot order as TOKEN_COLORS, so a player's chart color is
 * the legible cousin of their token color.
 */
export const CHART_SLOT_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
  "var(--chart-6)",
  "var(--chart-7)",
  "var(--chart-8)",
];

/**
 * The series color for a roller id. Color follows the entity: a slot keeps its
 * color no matter which filters are active. The DM is always gold; rollers whose
 * slot no longer exists get the neutral "ghost" ink.
 */
export function chartColorForRoller(who: string, slots: PlayerSlot[]): string {
  if (who === "dm") {
    return "var(--chart-dm)";
  }
  const index = slots.findIndex((slot) => slot.id === who);
  if (index < 0) {
    return "var(--chart-ghost)";
  }
  return CHART_SLOT_COLORS[index % CHART_SLOT_COLORS.length];
}
