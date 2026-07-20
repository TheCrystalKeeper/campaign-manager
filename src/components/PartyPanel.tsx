import { useState } from "react";
import { confirmDelete } from "./ConfirmDeleteDialog";
import type { GameState } from "../lib/types";
import type { useDmActions } from "../hooks/useGameRoom";

type PartyPanelProps = {
  state: GameState;
  dm: ReturnType<typeof useDmActions>;
  onViewSheet: (slotId: string) => void;
};

/// <summary>
/// DM party manager: create/rename/remove character slots, see who is online, and open a
/// player's sheet read-only. Rendered inside a FloatingWindow, which provides the title
/// bar and close control.
/// </summary>
export function PartyPanel({ state, dm, onViewSheet }: PartyPanelProps) {
  const [newName, setNewName] = useState("");
  const onlineIds = new Set(state.connectedPlayers.map((player) => player.playerId));

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
    <div className="panel-body stack">
        {state.playerSlots.length === 0 ? (
          <span className="muted">No character slots yet. Add one for each player.</span>
        ) : null}
        {state.playerSlots.map((slot) => (
          <div className="party-slot" key={slot.id}>
            <span className={`status-dot ${onlineIds.has(slot.id) ? "online" : ""}`} />
            <input
              // Remounts with the new name after an external rename commits.
              key={slot.name}
              defaultValue={slot.name}
              onBlur={(e) => {
                const name = e.target.value.trim();
                if (name && name !== slot.name) {
                  dm.updatePlayerSlot({ ...slot, name });
                }
              }}
            />
            <button onClick={() => onViewSheet(slot.id)} title="View sheet">
              Sheet
            </button>
            <button
              className="btn-danger"
              title="Remove"
              onClick={() => {
                void confirmDelete({
                  kind: "player",
                  name: slot.name,
                  detail: "This removes their slot, character sheet, and board tokens.",
                }).then((ok) => {
                  if (ok) dm.removePlayerSlot(slot.id);
                });
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
  );
}
