import { useRef, useState } from "react";
import {
  CONDITIONS,
  DEFAULT_TOKEN_SIZE,
  TOKEN_SHAPES,
  tokenSizeLabel,
  type GameState,
  type Token,
  type TokenHpDisplay,
  type TokenShape,
} from "../lib/types";
import { uploadTokenImage } from "../lib/uploadAsset";
import type { useDmActions } from "../hooks/useGameRoom";

type TokenEditorProps = {
  token: Token;
  state: GameState;
  dm: ReturnType<typeof useDmActions>;
  openSheet: (sheetId: string) => void;
  openItemSheet: (itemId: string) => void;
  onClose: () => void;
};

const SHAPE_LABEL: Record<TokenShape, string> = {
  circle: "● Circle",
  square: "■ Square",
  diamond: "◆ Diamond",
  triangle: "▲ Triangle",
  hexagon: "⬢ Hexagon",
  octagon: "⯃ Octagon",
};

/// <summary>
/// Compact DM editor for the selected token: label, color, shape, image, and (for
/// character tokens) owner, linked sheet, HP display, vision, and conditions.
/// </summary>
export function TokenEditor({ token, state, dm, openSheet, openItemSheet, onClose }: TokenEditorProps) {
  const isOwned = Boolean(token.ownerPlayerId);
  const isItem = token.kind === "item";
  const npcSheets = Object.values(state.sheets).filter((record) => record.kind === "npc");
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

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

  const uploadImage = async (file: File) => {
    setUploading(true);
    try {
      const { url } = await uploadTokenImage(state.roomId, token.id, file);
      dm.updateToken({ ...token, imageUrl: url });
    } catch {
      // Non-fatal: image stays unchanged.
    } finally {
      setUploading(false);
    }
  };
  // A token's own uploaded image (not the linked sheet's portrait) is what the fit toggle acts on.
  const hasOwnImage = Boolean(token.imageUrl);

  return (
    <div className="panel" style={{ width: "min(280px, 90vw)" }}>
      <div className="panel-header">
        <span className="panel-title">{isItem ? "🎒 Item token" : "Token"}</span>
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
            <label>Shape</label>
            <select
              value={token.shape ?? ""}
              onChange={(e) =>
                dm.updateToken({ ...token, shape: (e.target.value || undefined) as TokenShape | undefined })
              }
            >
              <option value="">Group default</option>
              {TOKEN_SHAPES.map((shape) => (
                <option key={shape} value={shape}>
                  {SHAPE_LABEL[shape]}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="field">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <label style={{ margin: 0 }}>
              Size ({token.size === undefined ? "default" : tokenSizeLabel(token.size)})
            </label>
            <button
              className={token.size === undefined ? "btn-active" : ""}
              title="Use the campaign default token size"
              onClick={() =>
                dm.updateToken({
                  ...token,
                  size: token.size === undefined ? (state.defaultTokenSize ?? DEFAULT_TOKEN_SIZE) : undefined,
                })
              }
            >
              {token.size === undefined ? "Default" : "Custom"}
            </button>
          </div>
          <input
            type="range"
            min={0.5}
            max={4}
            step={0.25}
            value={token.size ?? state.defaultTokenSize ?? DEFAULT_TOKEN_SIZE}
            disabled={token.size === undefined}
            onChange={(e) => dm.updateToken({ ...token, size: Number(e.target.value) })}
          />
        </div>

        <div className="field">
          <label>Token image</label>
          <div className="row">
            <button onClick={() => fileRef.current?.click()} disabled={uploading}>
              {uploading ? "Uploading…" : hasOwnImage ? "Change" : "Upload"}
            </button>
            {hasOwnImage ? (
              <button
                className="btn-ghost"
                onClick={() => dm.updateToken({ ...token, imageUrl: null })}
              >
                Clear
              </button>
            ) : null}
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              style={{ display: "none" }}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void uploadImage(file);
                e.target.value = "";
              }}
            />
          </div>
        </div>
        {hasOwnImage ? (
          <div className="row" style={{ justifyContent: "space-between" }}>
            <label style={{ margin: 0 }} title="Show the bare image, or clip it inside the token shape">
              Image style
            </label>
            <button
              className={token.imageFit === "raw" ? "btn-active" : ""}
              onClick={() =>
                dm.updateToken({ ...token, imageFit: token.imageFit === "raw" ? "framed" : "raw" })
              }
            >
              {token.imageFit === "raw" ? "Raw image" : "Framed in shape"}
            </button>
          </div>
        ) : null}

        {isItem ? (
          <button onClick={() => token.itemId && openItemSheet(token.itemId)} disabled={!token.itemId}>
            Open item sheet
          </button>
        ) : (
          <>
            <div className="field">
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
            {isOwned && token.ownerPlayerId ? (
              <button onClick={() => openSheet(token.ownerPlayerId!)}>Open sheet</button>
            ) : (
              <div className="field">
                <label>Sheet</label>
                <div className="row">
                  <select
                    value={token.sheetId ?? ""}
                    onChange={(e) => dm.updateToken({ ...token, sheetId: e.target.value || null })}
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
          </>
        )}

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

        {!isItem ? (
          <>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <label style={{ margin: 0 }}>Vision (sees in the dark)</label>
              <button
                className={token.vision?.enabled ? "btn-active" : ""}
                title="When dynamic lighting is on, this token reveals what it can see for its owner"
                onClick={() =>
                  dm.updateToken({
                    ...token,
                    vision: { enabled: !token.vision?.enabled, rangeFt: token.vision?.rangeFt ?? 0 },
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
                      vision: { enabled: true, rangeFt: Math.max(0, Number(e.target.value) || 0) },
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
          </>
        ) : null}

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
