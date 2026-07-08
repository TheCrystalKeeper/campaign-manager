import type { CharacterSheet, CheckSpec, SheetRecord, SheetSectionId } from "../lib/types";
import { SheetView } from "./sheet/SheetView";
import type { Adv, SheetActions, SheetEdit } from "./sheet/context";

type CharacterSheetPanelProps = {
  record: SheetRecord | null;
  canEdit: boolean;
  isDm: boolean;
  roomId: string;
  onChange: (sheet: CharacterSheet) => void;
  /** DM-only: flips a section's player visibility (NPC sheets). */
  onToggleReveal?: (section: SheetSectionId, revealed: boolean) => void;
  /**
   * Roll a structured check attributed to this sheet — the server resolves the modifiers
   * from the sheet and builds the color-coded breakdown. Shift = advantage, Alt = disadvantage.
   */
  onRollCheck?: (check: CheckSpec, adv?: Adv) => void;
  /** Rest with real effects (Tier 3); short rests may spend hit dice. */
  onRest?: (kind: "short" | "long", spendHitDice?: number) => void;
  /** Two-way conditions control for the Effects page (writes to linked tokens). */
  conditions?: SheetEdit["conditions"];
  /** Tier-3 resource actions (cast/use/death-save). */
  actions?: SheetActions;
};

/**
 * A character sheet. Thin wrapper over the Phase 7 tabbed `SheetView` (persistent left
 * vitals sidebar + right page rail). Used both as a floating window (panel registry) and
 * as page columns (SheetCards); the layout is responsive via container queries.
 */
export function CharacterSheetPanel(props: CharacterSheetPanelProps) {
  return <SheetView {...props} />;
}
