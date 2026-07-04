import { useState } from "react";
import { SheetCards } from "./SheetCards";
import { PageSwitcher, type PageId } from "./PageSwitcher";
import type { PanelContext } from "../panels/registry";

/// <summary>
/// DM-only Players page. With only a handful of players, the roster is a
/// browser-tab-style chip bar across the top instead of a sidebar: each chip
/// (status dot + name) TOGGLES that PC's full-size sheet open/closed in the
/// side-by-side scroller below; double-click renames the slot inline; the
/// hover ✕ removes it; ＋ Add creates "Player N". The compact Party dock tab
/// remains for quick in-play glances.
/// </summary>
export function PlayersPage({
  ctx,
  activePage,
  onNavigate,
}: {
  ctx: PanelContext;
  activePage: PageId;
  onNavigate: (id: PageId) => void;
}) {
  const { state, dm } = ctx;
  const [openIds, setOpenIds] = useState<string[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);

  const onlineIds = new Set(state.connectedPlayers.map((player) => player.playerId));

  const toggle = (id: string) =>
    setOpenIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  const close = (id: string) => setOpenIds((cur) => cur.filter((x) => x !== id));

  // PC sheet ids equal slot ids; keep the open order, drop any that vanished.
  const records = openIds
    .map((id) => state.sheets[id])
    .filter((record): record is NonNullable<typeof record> => Boolean(record));

  /** Smallest unused "Player N" name for one-click slot creation. */
  const nextDefaultName = () => {
    const taken = new Set(state.playerSlots.map((slot) => slot.name));
    let n = 1;
    while (taken.has(`Player ${n}`)) {
      n += 1;
    }
    return `Player ${n}`;
  };

  return (
    <div className="players-page">
      <div className="chip-tabs player-tabs">
        <PageSwitcher active={activePage} onSelect={onNavigate} className="page-switcher--inline" />
        <span className="page-topbar-sep" aria-hidden />
        {state.playerSlots.map((slot) => (
          <div
            key={slot.id}
            className={`chip-tab${openIds.includes(slot.id) ? " chip-tab--open" : ""}`}
            title={openIds.includes(slot.id) ? "Click to close sheet" : "Click to open sheet"}
            onClick={() => {
              if (editingId !== slot.id) {
                toggle(slot.id);
              }
            }}
          >
            <span
              className={`status-dot ${onlineIds.has(slot.id) ? "online" : ""}`}
              title={onlineIds.has(slot.id) ? "Online" : "Offline"}
            />
            <input
              className="chip-tab-name-input"
              // Remounts with the new name after an external rename commits.
              key={slot.name}
              defaultValue={slot.name}
              readOnly={editingId !== slot.id}
              size={Math.max(slot.name.length, 4)}
              title={editingId === slot.id ? undefined : "Double-click to rename"}
              onClick={(e) => {
                // While editing, clicks belong to the input, not the toggle.
                if (editingId === slot.id) {
                  e.stopPropagation();
                }
              }}
              onDoubleClick={(e) => {
                e.stopPropagation();
                setEditingId(slot.id);
                const input = e.currentTarget;
                requestAnimationFrame(() => {
                  input.focus();
                  input.select();
                });
              }}
              onBlur={(e) => {
                const name = e.target.value.trim();
                if (name && name !== slot.name) {
                  dm.updatePlayerSlot({ ...slot, name });
                } else {
                  e.target.value = slot.name;
                }
                setEditingId(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.currentTarget.blur();
                } else if (e.key === "Escape") {
                  e.currentTarget.value = slot.name;
                  e.currentTarget.blur();
                }
              }}
            />
            <button
              className="chip-tab-close"
              title="Remove slot"
              onClick={(e) => {
                e.stopPropagation();
                close(slot.id);
                dm.removePlayerSlot(slot.id);
              }}
            >
              ✕
            </button>
          </div>
        ))}
        <button
          className="chip-tab chip-tab--add"
          title="Add a player slot"
          onClick={() => dm.addPlayerSlot(nextDefaultName())}
        >
          ＋ Add
        </button>
      </div>

      <div className="players-page-body">
        <SheetCards
          records={records}
          isDm
          roomId={state.roomId}
          onClose={close}
          onChange={(id, sheet) => ctx.updateSheet(id, sheet)}
          onRoll={(id, label, modifier, adv) =>
            ctx.rollDice(`1d20${modifier >= 0 ? `+${modifier}` : modifier}`, {
              context: { sheetId: id, label },
              adv,
            })
          }
          emptyHint={
            state.playerSlots.length === 0
              ? "No character slots yet — click ＋ Add to create one for each player."
              : "Click a player above to open their sheet. Open several to compare side by side."
          }
        />
      </div>
    </div>
  );
}
