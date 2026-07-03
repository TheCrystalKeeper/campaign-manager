import { CharacterSheetPanel } from "../components/CharacterSheet";
import type { CharacterSheet, SheetRecord, SheetSectionId } from "../lib/types";

type SheetCardsProps = {
  /** The open sheets, in the order they should appear left-to-right. */
  records: SheetRecord[];
  isDm: boolean;
  roomId: string;
  onClose: (id: string) => void;
  onChange: (id: string, sheet: CharacterSheet) => void;
  onRoll: (id: string, label: string, modifier: number, adv?: "adv" | "dis") => void;
  /** NPC-only: per-section reveal toggle. */
  onToggleReveal?: (id: string, section: SheetSectionId, revealed: boolean) => void;
  emptyHint: string;
};

/// <summary>
/// The prep-page main area: every open sheet is a fixed-width column, laid out
/// left-to-right and horizontally scrollable when more are open than fit. Each
/// column is its own CSS size container, so the sheet inside stays single-column
/// and compact (the multi-column reflow is for wide floating windows).
/// </summary>
export function SheetCards({
  records,
  isDm,
  roomId,
  onClose,
  onChange,
  onRoll,
  onToggleReveal,
  emptyHint,
}: SheetCardsProps) {
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
              isDm={isDm}
              roomId={roomId}
              onChange={(sheet) => onChange(record.id, sheet)}
              onToggleReveal={
                onToggleReveal
                  ? (section, revealed) => onToggleReveal(record.id, section, revealed)
                  : undefined
              }
              onRoll={(label, modifier, adv) => onRoll(record.id, label, modifier, adv)}
            />
          </div>
        </section>
      ))}
    </div>
  );
}
