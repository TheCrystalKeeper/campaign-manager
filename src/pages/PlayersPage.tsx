import { useState } from "react";
import { SheetCards } from "./SheetCards";
import { PageShell } from "./PageShell";
import type { PanelContext } from "../panels/registry";

/// <summary>
/// DM-only Players page: party administration beside full-size PC sheets.
/// Clicking anywhere on a slot row opens that PC's sheet (several can be open
/// side by side); double-clicking the name field renames the slot. The compact
/// Party dock tab remains for quick in-play glances.
/// </summary>
export function PlayersPage({ ctx }: { ctx: PanelContext }) {
  const { state, dm } = ctx;
  const [openIds, setOpenIds] = useState<string[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [newName, setNewName] = useState("");

  const onlineIds = new Set(state.connectedPlayers.map((player) => player.playerId));

  const open = (id: string) => setOpenIds((cur) => (cur.includes(id) ? cur : [...cur, id]));
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

  const addSlot = () => {
    dm.addPlayerSlot(newName.trim() || nextDefaultName());
    setNewName("");
  };

  return (
    <PageShell
      roster={
        <div className="stack">
          <div className="section-title">Party</div>
          {state.playerSlots.length === 0 ? (
            <span className="muted">No character slots yet. Add one for each player.</span>
          ) : null}
          {state.playerSlots.map((slot) => (
            <div
              className={`party-slot party-slot--row${
                openIds.includes(slot.id) ? " party-slot--selected" : ""
              }`}
              key={slot.id}
              title="Click to open sheet"
              onClick={() => open(slot.id)}
            >
              <span
                className={`status-dot ${onlineIds.has(slot.id) ? "online" : ""}`}
                title={onlineIds.has(slot.id) ? "Online" : "Offline"}
              />
              <input
                className="party-slot-name"
                // Remounts with the new name after an external rename commits.
                key={slot.name}
                defaultValue={slot.name}
                readOnly={editingId !== slot.id}
                title={editingId === slot.id ? undefined : "Double-click to rename"}
                onDoubleClick={(e) => {
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
                className="btn-danger"
                title="Remove slot"
                onClick={(e) => {
                  e.stopPropagation();
                  dm.removePlayerSlot(slot.id);
                }}
              >
                ✕
              </button>
            </div>
          ))}
          <div className="row">
            <input
              value={newName}
              placeholder="Name (optional)"
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") addSlot();
              }}
            />
            <button className="btn-primary" title="Add a player slot" onClick={addSlot}>
              ＋ Add
            </button>
          </div>
        </div>
      }
    >
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
        emptyHint="Click a player to open their sheet. Open several to compare side by side."
      />
    </PageShell>
  );
}
