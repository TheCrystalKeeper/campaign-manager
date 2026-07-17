import type { GameState } from "./types";

/** One place a stored asset URL is referenced in the campaign. */
export type AssetUsage = {
  kind: "token" | "sheet" | "scene" | "backdrop" | "item" | "campaign-icon";
  id: string;
  label: string;
};

/**
 * Finds everywhere a stored-asset URL is used across the campaign (Phase 7 Assets page):
 * token images, sheet portraits, scene maps + backdrops, item icons, and the campaign icon.
 * Pure — the DM's "in use by N places" delete warning scans this so an in-use image isn't
 * dropped by accident. The campaign icon lives on the shared registry (not game state), so
 * its current URL is passed in.
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
    usage.push({ kind: "token", id: token.id, label: token.label || "Token" });
  }
  for (const record of Object.values(state.sheets)) {
    if (record.data.iconUrl === url) {
      usage.push({ kind: "sheet", id: record.id, label: record.data.characterName || "Sheet" });
    }
  }
  for (const scene of state.scenes) {
    if (scene.mapUrl === url) {
      usage.push({ kind: "scene", id: scene.id, label: scene.name || "Scene" });
    }
    if (scene.boardBgImageUrl === url) {
      usage.push({ kind: "backdrop", id: scene.id, label: scene.name || "Scene" });
    }
  }
  for (const item of Object.values(state.items)) {
    if (item.iconUrl === url) {
      usage.push({ kind: "item", id: item.id, label: item.name || "Item" });
    }
  }
  if (campaignIconUrl && campaignIconUrl === url) {
    usage.push({ kind: "campaign-icon", id: state.roomId, label: "Campaign icon" });
  }
  return usage;
}

/**
 * Which Assets-page section an image belongs in, usage-first: an unreferenced image goes
 * to "unused" regardless of its folder; the campaign icon goes to "icons"; a map file OR any
 * image used as a scene backdrop goes to "maps"; otherwise its stored folder kind
 * (tokens/portraits). Pure, so the grouping is unit-testable independent of the R2 listing.
 */
export function assetSection(assetKind: string, usage: AssetUsage[]): string {
  if (usage.length === 0) return "unused";
  if (usage.some((u) => u.kind === "campaign-icon")) return "icons";
  if (assetKind === "maps" || usage.some((u) => u.kind === "backdrop")) return "maps";
  return assetKind;
}
