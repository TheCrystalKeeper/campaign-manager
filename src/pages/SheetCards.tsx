import { CharacterSheetPanel } from "../components/CharacterSheet";
import { buildConditionsControl } from "../components/sheet/conditionsControl";
import type { PanelContext } from "../panels/registry";
import type { SheetRecord } from "../lib/types";

type SheetCardsProps = {
  ctx: PanelContext;
  /** The open sheets, in the order they should appear left-to-right. */
  records: SheetRecord[];
  onClose: (id: string) => void;
  /** NPC page: show the per-page reveal eyes. */
  allowReveal?: boolean;
  emptyHint: string;
};

/// <summary>
/// The prep-page main area: every open sheet is a fixed-width column, laid out
/// left-to-right and horizontally scrollable when more are open than fit. Each
/// column is its own CSS size container, so the tabbed sheet inside adapts (sidebar
/// collapses, single-column pages) exactly like a narrow floating window.
/// </summary>
export function SheetCards({ ctx, records, onClose, allowReveal, emptyHint }: SheetCardsProps) {
  if (records.length === 0) {
    return <div className="page-empty muted">{emptyHint}</div>;
  }

  return (
    <div className="sheet-cards">
      {records.map((record) => (
        <section className="sheet-col" key={record.id}>
          <header className="sheet-col-head">
            <span className="window-title">
              {record.data.characterName || (record.redacted ? "???" : "Character")}
            </span>
            <button
              className="btn-ghost icon-btn"
              title="Close this sheet"
              onClick={() => onClose(record.id)}
            >
              ✕
            </button>
          </header>
          <div className="sheet-col-body">
            <CharacterSheetPanel
              record={record}
              canEdit
              isDm={ctx.isDm}
              roomId={ctx.state.roomId}
              onChange={(sheet) => ctx.updateSheet(record.id, sheet)}
              onToggleReveal={
                allowReveal
                  ? (section, revealed) => ctx.dm.setSheetReveal(record.id, section, revealed)
                  : undefined
              }
              onRollCheck={(check, adv) => ctx.rollCheck(record.id, check, adv)}
              onRest={(kind, spendHitDice) => ctx.room.send({ type: "REST", sheetId: record.id, kind, spendHitDice })}
              conditions={buildConditionsControl(ctx.state.tokens, record.id, true, ctx.room.send)}
              actions={{
                castSpell: (level) => ctx.room.send({ type: "CAST_SPELL", sheetId: record.id, level }),
                useFeature: (featureId) => ctx.room.send({ type: "USE_FEATURE", sheetId: record.id, featureId }),
                useItemCharge: (rowId) => ctx.room.send({ type: "USE_ITEM_CHARGE", sheetId: record.id, rowId }),
                deathSave: () => ctx.room.send({ type: "DEATH_SAVE", sheetId: record.id }),
              }}
            />
          </div>
        </section>
      ))}
    </div>
  );
}
