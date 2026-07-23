import { createContext, useContext } from "react";
import {
  createEmptyHomebrew,
  type GameState,
  type HomebrewState,
  type ItemRecord,
  type SheetRecord,
} from "../lib/types";

/// <summary>
/// Read-side access to the campaign's homebrew content for the compendium pickers,
/// however deep they sit in the sheet tree (no prop drilling). App mounts the provider
/// from room state; the default (empty) value keeps pickers working in contexts without
/// a provider (nothing merged).
/// </summary>

export type HomebrewContextValue = {
  homebrew: HomebrewState;
  /** NPC sheets published to the monster picker ("Show in monster compendium"). */
  npcTemplates: SheetRecord[];
  /** Catalog items published to the item picker ("Show in item compendium"). */
  catalogItems: ItemRecord[];
};

const EMPTY: HomebrewContextValue = {
  homebrew: createEmptyHomebrew(),
  npcTemplates: [],
  catalogItems: [],
};

const HomebrewContext = createContext<HomebrewContextValue>(EMPTY);

export const HomebrewProvider = HomebrewContext.Provider;

export function useHomebrew(): HomebrewContextValue {
  return useContext(HomebrewContext);
}

/** Derives the provider value from room state (memoize on `state` at the call site). */
export function buildHomebrewContext(state: GameState): HomebrewContextValue {
  return {
    homebrew: state.homebrew,
    // Redacted copies exclude hidden-section data; a player's monster picker isn't a
    // thing today (DM-only), but filter redacted records anyway so a future player
    // surface never leaks a half-hidden statblock.
    npcTemplates: Object.values(state.sheets).filter(
      (record) => record.kind === "npc" && record.homebrew && !record.redacted,
    ),
    catalogItems: Object.values(state.items).filter((item) => item.homebrew),
  };
}
