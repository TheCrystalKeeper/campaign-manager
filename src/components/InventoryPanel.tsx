import type { PanelContext } from "../panels/registry";
import { useSheetEdit } from "./sheet/useSheetEdit";
import { InventoryPage } from "./sheet/pages/InventoryPage";

/// <summary>
/// The player's docked Inventory panel: the character sheet's Inventory page
/// (encumbrance, currency, attunement, category tables) rendered against their own
/// PC sheet, so the sidebar and the sheet window edit the same data. Player-only —
/// the DM reaches any inventory through the sheet window instead.
/// </summary>
export function InventoryPanel({ ctx }: { ctx: PanelContext }) {
  // PC sheet ids equal player slot ids.
  const sheetId = ctx.room.yourPlayerId;
  const record = sheetId ? ctx.state.sheets[sheetId] ?? null : null;
  const { sheet } = useSheetEdit(record, {
    canEdit: true, // always the player's own sheet; the server re-checks anyway
    isDm: false, // roles: ["player"] — the DM never mounts this panel
    roomId: ctx.state.roomId,
    onChange: (patch) => {
      if (sheetId) ctx.updateSheet(sheetId, patch);
    },
    onRollCheck: sheetId ? (check, adv) => ctx.rollCheck(sheetId, check, adv) : undefined,
    actions: sheetId
      ? {
          castSpell: (level) => ctx.room.send({ type: "CAST_SPELL", sheetId, level }),
          useFeature: (featureId) => ctx.room.send({ type: "USE_FEATURE", sheetId, featureId }),
          useItemCharge: (rowId) => ctx.room.send({ type: "USE_ITEM_CHARGE", sheetId, rowId }),
          deathSave: () => ctx.room.send({ type: "DEATH_SAVE", sheetId }),
        }
      : undefined,
  });

  if (!sheet) {
    return (
      <div className="panel-body">
        <span className="muted">Your character sheet hasn't been created yet.</span>
      </div>
    );
  }

  return (
    <div className="inventory-panel">
      <InventoryPage sheet={sheet} />
    </div>
  );
}
