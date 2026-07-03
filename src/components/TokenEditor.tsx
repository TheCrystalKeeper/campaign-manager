import { CONDITIONS, type GameState, type Token, type TokenHpDisplay } from "../lib/types";
import type { useDmActions } from "../hooks/useGameRoom";

type TokenEditorProps = {
  token: Token;
  state: GameState;
  dm: ReturnType<typeof useDmActions>;
  openSheet: (sheetId: string) => void;
  onClose: () => void;
};

/// <summary>
/// Compact DM editor for the selected token: label, color, owner (assigning a player slot
/// turns it into that player's token), linked sheet, and delete.
/// </summary>
export function TokenEditor({ token, state, dm, openSheet, onClose }: TokenEditorProps) {
  const isOwned = Boolean(token.ownerPlayerId);
  const npcSheets = Object.values(state.sheets).filter((record) => record.kind === "npc");

  const setOwner = (slotId: string) => {
    if (slotId === "") {
      dm.updateToken({ ...token, kind: "enemy", ownerPlayerId: null });
    } else {
      dm.updateToken({ ...token, kind: "player", ownerPlayerId: slotId });
    }
  };

  const createAndLinkSheet = () => {
    const sheetId = `sheet-${crypto.randomUUID().slice(0, 8)}`;
    dm.createSheet(sheetId, token.label || "NPC");
    dm.updateToken({ ...token, sheetId });
    openSheet(sheetId);
  };

  const toggleCondition = (id: string) => {
    const conditions = token.conditions.includes(id)
      ? token.conditions.filter((item) => item !== id)
      : [...token.conditions, id];
    dm.updateToken({ ...token, conditions });
  };

  return (
    <div className="panel" style={{ width: "min(280px, 90vw)" }}>
      <div className="panel-header">
        <span className="panel-title">Token</span>
        <button className="btn-ghost icon-btn" onClick={onClose}>
          ✕
        </button>
      </div>
      <div className="panel-body stack">
        <div className="field">
          <label>Label</label>
          <input
            defaultValue={token.label}
            key={token.id + token.label}
            disabled={isOwned}
            onBlur={(e) => dm.updateToken({ ...token, label: e.target.value })}
          />
        </div>
        <div className="row">
          <div style={{ flex: 1 }}>
            <label>Color</label>
            <input
              type="color"
              value={token.color}
              disabled={isOwned}
              onChange={(e) => dm.updateToken({ ...token, color: e.target.value })}
            />
          </div>
          <div style={{ flex: 2 }}>
            <label>Owner</label>
            <select value={token.ownerPlayerId ?? ""} onChange={(e) => setOwner(e.target.value)}>
              <option value="">None (enemy/NPC)</option>
              {state.playerSlots.map((slot) => (
                <option key={slot.id} value={slot.id}>
                  {slot.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        {isOwned && token.ownerPlayerId ? (
          <button onClick={() => openSheet(token.ownerPlayerId!)}>Open sheet</button>
        ) : (
          <div className="field">
            <label>Sheet</label>
            <div className="row">
              <select
                value={token.sheetId ?? ""}
                onChange={(e) =>
                  dm.updateToken({ ...token, sheetId: e.target.value || null })
                }
                style={{ flex: 1 }}
              >
                <option value="">None</option>
                {npcSheets.map((record) => (
                  <option key={record.id} value={record.id}>
                    {record.data.characterName || "Unnamed NPC"}
                  </option>
                ))}
              </select>
              {token.sheetId ? (
                <button onClick={() => openSheet(token.sheetId!)} title="Open linked sheet">
                  Open
                </button>
              ) : (
                <button onClick={createAndLinkSheet} title="Create an NPC sheet for this token">
                  New
                </button>
              )}
            </div>
          </div>
        )}
        {token.sheetId ? (
          <div className="field">
            <label>Show HP to players</label>
            <select
              value={token.showHp}
              onChange={(e) =>
                dm.updateToken({ ...token, showHp: e.target.value as TokenHpDisplay })
              }
            >
              <option value="none">Hidden</option>
              <option value="bar">Bar only</option>
              <option value="values">Bar + numbers</option>
            </select>
          </div>
        ) : null}

        <div className="row" style={{ justifyContent: "space-between" }}>
          <label style={{ margin: 0 }}>Hidden from players</label>
          <button
            className={token.hidden ? "btn-active" : ""}
            title="Hidden tokens never reach player clients — you see them ghosted"
            onClick={() => dm.updateToken({ ...token, hidden: !token.hidden })}
          >
            {token.hidden ? "👁 Hidden" : "Visible"}
          </button>
        </div>

        <div className="row" style={{ justifyContent: "space-between" }}>
          <label style={{ margin: 0 }}>Vision (sees in the dark)</label>
          <button
            className={token.vision?.enabled ? "btn-active" : ""}
            title="When dynamic lighting is on, this token reveals what it can see for its owner"
            onClick={() =>
              dm.updateToken({
                ...token,
                vision: {
                  enabled: !token.vision?.enabled,
                  rangeFt: token.vision?.rangeFt ?? 0,
                },
              })
            }
          >
            {token.vision?.enabled ? "On" : "Off"}
          </button>
        </div>
        {token.vision?.enabled ? (
          <div className="field">
            <label>Darkvision range (ft, 0 = only lit areas)</label>
            <input
              type="number"
              min={0}
              step={5}
              value={token.vision.rangeFt}
              onChange={(e) =>
                dm.updateToken({
                  ...token,
                  vision: {
                    enabled: true,
                    rangeFt: Math.max(0, Number(e.target.value) || 0),
                  },
                })
              }
            />
          </div>
        ) : null}

        <div className="field">
          <label>Conditions</label>
          <div className="cond-grid">
            {CONDITIONS.map((condition) => (
              <button
                key={condition.id}
                className={`cond-chip ${token.conditions.includes(condition.id) ? "btn-active" : ""}`}
                title={condition.label}
                onClick={() => toggleCondition(condition.id)}
              >
                {condition.emoji}
              </button>
            ))}
          </div>
        </div>

        <button
          className="btn-danger"
          onClick={() => {
            dm.removeToken(token.id);
            onClose();
          }}
        >
          Delete token
        </button>
      </div>
    </div>
  );
}
