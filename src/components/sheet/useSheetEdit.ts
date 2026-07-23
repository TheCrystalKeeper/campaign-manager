import type { CharacterSheet, SheetRecord, SheetSectionId } from "../../lib/types";
import { computeDerived } from "../../lib/rules5e";
import { useSheetDraft } from "./useSheetDraft";
import type { SheetActions, SheetEdit } from "./context";

/**
 * Assembles the `SheetEdit` bag every sheet page renders from: the debounced local
 * draft, the rules-engine derived totals, and the override setter. Shared by the full
 * `SheetView` and the docked Inventory panel so both build identical edit contexts
 * (and the override-clearing subtlety lives in exactly one place).
 */
export function useSheetEdit(
  record: SheetRecord | null,
  opts: {
    canEdit: boolean;
    isDm: boolean;
    roomId: string;
    onChange: (sheet: Partial<CharacterSheet>) => void;
    onRollCheck?: SheetEdit["onRollCheck"];
    conditions?: SheetEdit["conditions"];
    actions?: SheetActions;
    homebrewTemplate?: SheetEdit["homebrewTemplate"];
  },
): {
  sheet: SheetEdit | null;
  uploading: boolean;
  handlePortrait: (file: File) => Promise<void>;
  overSoftCap: boolean;
} {
  // The draft hook must run unconditionally (before the null-record return) so the
  // hook order stays stable while a sheet appears/disappears.
  const { value, update, uploading, handlePortrait, overSoftCap } = useSheetDraft(
    record,
    opts.canEdit,
    opts.roomId,
    opts.onChange,
  );

  if (!record) {
    return { sheet: null, uploading, handlePortrait, overSoftCap };
  }

  // Rules engine: derived totals for display (PC formulas + overrides; NPC passthrough).
  // Cheap pure math — recompute on every draft change so totals track edits live.
  const derived = computeDerived(value, record.kind);
  const setOverride = (key: string, next: number | null) => {
    const overrides = { ...value.overrides };
    // Typing the formula's own value back in means "return to auto".
    if (next === null || next === derived.base[key]) {
      delete overrides[key];
    } else {
      overrides[key] = next;
    }
    update({ overrides });
  };

  const hiddenFor = (section: SheetSectionId) =>
    !opts.isDm && record.kind === "npc" && !record.revealed[section];

  return {
    sheet: {
      value,
      id: record.id,
      roomId: opts.roomId,
      kind: record.kind,
      canEdit: opts.canEdit,
      isDm: opts.isDm,
      derived,
      setOverride,
      update,
      hiddenFor,
      onRollCheck: opts.onRollCheck,
      conditions: opts.conditions,
      actions: opts.actions,
      homebrewTemplate: opts.homebrewTemplate,
    },
    uploading,
    handlePortrait,
    overSoftCap,
  };
}
