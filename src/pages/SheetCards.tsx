import { useRef, useSyncExternalStore } from "react";
import { CharacterSheetPanel } from "../components/CharacterSheet";
import { buildConditionsControl } from "../components/sheet/conditionsControl";
import { campaignKey } from "../lib/campaignStore";
import type { PanelContext } from "../panels/registry";
import type { SheetRecord } from "../lib/types";

/* One width shared by every sheet column on the Players AND NPCs pages,
   persisted per campaign. Bounds/default match the floating sheet window: min 760 keeps
   the Main page at two columns with single-line skills; default opens a touch wider. An
   old narrower saved width auto-clamps up to the new minimum. */
const widthKey = (roomId: string) => campaignKey(roomId, "sheet-col-w");
const MIN_W = 760;
const MAX_W = 1200;
const DEFAULT_W = 800;

function loadWidth(roomId: string): number {
  try {
    const raw = localStorage.getItem(widthKey(roomId));
    const n = raw ? Number(raw) : NaN;
    if (Number.isFinite(n)) {
      return Math.min(Math.max(n, MIN_W), MAX_W);
    }
  } catch {
    // fall through to the default
  }
  return DEFAULT_W;
}

function saveWidth(roomId: string, width: number) {
  try {
    localStorage.setItem(widthKey(roomId), String(Math.round(width)));
  } catch {
    // width just won't persist
  }
}

/* Module-level store (useSyncExternalStore) rather than component state: the Players
   and NPCs pages each mount their own SheetCards and BOTH stay mounted, so dragging on
   one page must move the other's columns live, not on its next remount. */
let sharedWidth: number | null = null;
let sharedRoom: string | null = null;
const widthListeners = new Set<() => void>();
function getSharedWidth(roomId: string): number {
  if (sharedWidth === null || sharedRoom !== roomId) {
    sharedWidth = loadWidth(roomId);
    sharedRoom = roomId;
  }
  return sharedWidth;
}
function setSharedWidth(width: number) {
  sharedWidth = width;
  widthListeners.forEach((notify) => notify());
}
function subscribeWidth(listener: () => void) {
  widthListeners.add(listener);
  return () => widthListeners.delete(listener);
}

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
/// The prep-page main area: every open sheet is a column, laid out left-to-right
/// and horizontally scrollable when more are open than fit. All columns share ONE
/// width — dragging any column's right edge resizes them all together (double-click
/// resets), and the width persists per campaign. Each column is its own CSS size
/// container, so the tabbed sheet inside adapts (sidebar collapses, pages go
/// multi-column when wide) exactly like a floating window at that size.
/// </summary>
export function SheetCards({ ctx, records, onClose, allowReveal, emptyHint }: SheetCardsProps) {
  const roomId = ctx.state.roomId;
  const colWidth = useSyncExternalStore(subscribeWidth, () => getSharedWidth(roomId));
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);

  const onHandleDown = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    dragRef.current = { startX: event.clientX, startWidth: colWidth };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onHandleMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) {
      return;
    }
    setSharedWidth(Math.min(Math.max(drag.startWidth + event.clientX - drag.startX, MIN_W), MAX_W));
  };
  const onHandleUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) {
      return;
    }
    dragRef.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
    saveWidth(roomId, sharedWidth ?? DEFAULT_W);
  };
  const onHandleReset = () => {
    setSharedWidth(DEFAULT_W);
    saveWidth(roomId, DEFAULT_W);
  };

  if (records.length === 0) {
    return <div className="page-empty muted">{emptyHint}</div>;
  }

  return (
    <div className="sheet-cards" style={{ "--sheet-col-w": `${colWidth}px` } as React.CSSProperties}>
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
              homebrewTemplate={
                ctx.isDm && record.kind === "npc"
                  ? {
                      on: Boolean(record.homebrew),
                      toggle: (on) => ctx.dm.setSheetHomebrew(record.id, on),
                    }
                  : undefined
              }
              actions={{
                castSpell: (level) => ctx.room.send({ type: "CAST_SPELL", sheetId: record.id, level }),
                useFeature: (featureId) => ctx.room.send({ type: "USE_FEATURE", sheetId: record.id, featureId }),
                useItemCharge: (rowId) => ctx.room.send({ type: "USE_ITEM_CHARGE", sheetId: record.id, rowId }),
                deathSave: () => ctx.room.send({ type: "DEATH_SAVE", sheetId: record.id }),
              }}
            />
          </div>
          <div
            className="sheet-col-resize"
            title="Drag to resize all sheets · double-click to reset"
            onPointerDown={onHandleDown}
            onPointerMove={onHandleMove}
            onPointerUp={onHandleUp}
            onPointerCancel={onHandleUp}
            onDoubleClick={onHandleReset}
          />
        </section>
      ))}
    </div>
  );
}
