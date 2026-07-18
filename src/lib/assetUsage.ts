import type { GameState } from "./types";

/**
 * Which Assets-page section a usage puts its image in. Grouping is by what the image
 * *depicts* (the entity referencing it), not by which folder the file was uploaded to —
 * so a character's portrait and that same character's map token land together under
 * "characters" rather than being split across "portraits" and "tokens".
 */
export type AssetGroup =
  | "characters"
  | "npcs"
  | "items"
  | "maps"
  | "handouts"
  | "icons";

/** One place a stored asset URL is referenced in the campaign. */
export type AssetUsage = {
  kind: "token" | "sheet" | "scene" | "backdrop" | "item" | "campaign-icon" | "handout";
  id: string;
  label: string;
  /** The Assets-page section this reference contributes to. See assetSection. */
  group: AssetGroup;
};

// A standalone token's kind and a sheet's kind both map onto the same entity buckets a DM
// thinks in (Characters / NPCs / Items), so token art and portraits of the same actor group
// together.
const TOKEN_GROUP: Record<string, AssetGroup> = {
  player: "characters",
  enemy: "npcs",
  item: "items",
};

/**
 * Finds everywhere a stored-asset URL is used across the campaign (Phase 7 Assets page):
 * token images, sheet portraits, scene maps + backdrops, item icons, handouts, and the
 * campaign icon. Pure — the DM's "in use by N places" delete warning scans this so an
 * in-use image isn't dropped by accident. The campaign icon lives on the shared registry
 * (not game state), so its current URL is passed in. Each usage carries the section it
 * belongs to (see AssetGroup) so the grouping stays entity-based, not folder-based.
 */
export function findAssetUsage(
  state: GameState,
  url: string,
  campaignIconUrl?: string | null,
): AssetUsage[] {
  const usage: AssetUsage[] = [];
  for (const token of state.tokens) {
    if (token.imageUrl !== url) continue;
    // A token linked to a sheet/item just mirrors that source's image — the sheet/item is the
    // real reference, so don't double-count the mirror (otherwise one portrait reads as "used
    // in N places", once per token). Only a standalone token with its own image counts here.
    const linkedSheetId = token.sheetId ?? token.ownerPlayerId;
    const mirrorsSheet = linkedSheetId != null && state.sheets[linkedSheetId]?.data.iconUrl === url;
    const mirrorsItem = token.itemId != null && state.items[token.itemId]?.iconUrl === url;
    if (mirrorsSheet || mirrorsItem) continue;
    usage.push({
      kind: "token",
      id: token.id,
      label: token.label || "Token",
      group: TOKEN_GROUP[token.kind] ?? "characters",
    });
  }
  for (const record of Object.values(state.sheets)) {
    if (record.data.iconUrl === url) {
      usage.push({
        kind: "sheet",
        id: record.id,
        label: record.data.characterName || "Sheet",
        group: record.kind === "npc" ? "npcs" : "characters",
      });
    }
  }
  for (const scene of state.scenes) {
    if (scene.mapUrl === url) {
      usage.push({ kind: "scene", id: scene.id, label: scene.name || "Scene", group: "maps" });
    }
    if (scene.boardBgImageUrl === url) {
      usage.push({ kind: "backdrop", id: scene.id, label: scene.name || "Scene", group: "maps" });
    }
  }
  for (const item of Object.values(state.items)) {
    if (item.iconUrl === url) {
      usage.push({ kind: "item", id: item.id, label: item.name || "Item", group: "items" });
    }
  }
  for (const handout of state.handouts) {
    if (handout.imageUrl === url) {
      usage.push({
        kind: "handout",
        id: handout.id,
        label: handout.name || "Handout",
        group: "handouts",
      });
    }
  }
  if (campaignIconUrl && campaignIconUrl === url) {
    usage.push({ kind: "campaign-icon", id: state.roomId, label: "Campaign icon", group: "icons" });
  }
  return usage;
}

// Section priority when one image is referenced from several groups: the highest-priority
// group present wins. Handouts sits last so an image that is *also* real actor/item art lands
// with that art, and "handouts" only claims images whose sole use is a handout.
const GROUP_PRIORITY: AssetGroup[] = ["icons", "maps", "characters", "npcs", "items", "handouts"];

/**
 * Which Assets-page section an image belongs in, usage-first: an unreferenced image goes
 * to "unused" regardless of its folder; otherwise the highest-priority group among its
 * references (see GROUP_PRIORITY) — the campaign icon → "icons", scene maps/backdrops →
 * "maps", PC portraits/player tokens → "characters", NPC portraits/enemy tokens → "npcs",
 * items/item tokens → "items", and handout-only images → "handouts". Pure, so the grouping
 * is unit-testable independent of the R2 listing.
 */
export function assetSection(usage: AssetUsage[]): string {
  if (usage.length === 0) return "unused";
  return GROUP_PRIORITY.find((group) => usage.some((u) => u.group === group)) ?? "unused";
}
