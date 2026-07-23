import { useRef, useState } from "react";
import { Ban, EyeOff, Hand } from "lucide-react";
import {
  CONDITIONS,
  DEFAULT_ICON_CROP,
  DEFAULT_TOKEN_SIZE,
  PORTRAIT_ASPECT,
  TOKEN_ENEMY_COLOR,
  TOKEN_SHAPES,
  tokenSizeLabel,
  type GameState,
  type IconCrop,
  type Token,
  type TokenHpDisplay,
  type TokenShape,
} from "../lib/types";
import { uploadPortrait, uploadTokenImage } from "../lib/uploadAsset";
import type { useDmActions } from "../hooks/useGameRoom";
import { HpStepper } from "./HpStepper";
import { AssetPickerModal } from "./AssetPickerModal";
import { ImageCropModal } from "./ImageCropModal";

type TokenEditorProps = {
  token: Token;
  state: GameState;
  dm: ReturnType<typeof useDmActions>;
  openSheet: (sheetId: string) => void;
  openItemSheet: (itemId: string) => void;
  /** Clear the token selection (closes the hosting window) — used after Delete. */
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
  // A "player character" token derives its whole identity (name/colour/portrait) from its
  // player. A token a player merely *controls* (an NPC handed to them — "mind control") stays
  // kind "enemy" and keeps its own identity; only its movement follows the player.
  const isPlayerChar = token.kind === "player";
  const isItem = token.kind === "item";
  // Linked tokens (sheet or item) mirror their entity's name live (see syncTokenFromState) —
  // editing the Label here would just get overwritten on the next sync.
  const isLinked = isPlayerChar || Boolean(token.sheetId) || Boolean(token.itemId);
  const controllerSlot = token.ownerPlayerId
    ? state.playerSlots.find((slot) => slot.id === token.ownerPlayerId)
    : undefined;
  const controlledNpc = !isPlayerChar && Boolean(controllerSlot);
  const npcSheets = Object.values(state.sheets).filter((record) => record.kind === "npc");
  const [uploading, setUploading] = useState(false);
  const [libOpen, setLibOpen] = useState(false);
  const [cropOpen, setCropOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // The token's image is shared with its linked sheet's portrait (mirrors the map's
  // display logic in MapCanvas). When a sheet is linked, uploads/clears target that
  // sheet's `iconUrl` so the Token panel and the character sheet stay in sync.
  const linkedSheetId = token.sheetId ?? token.ownerPlayerId;
  const linkedSheet = linkedSheetId ? state.sheets[linkedSheetId] : undefined;
  // Item tokens share their catalog item's icon, the same way sheet tokens share the portrait.
  const linkedItem = token.itemId ? state.items[token.itemId] : undefined;
  const effectiveImage = linkedSheet?.data.iconUrl ?? linkedItem?.iconUrl ?? token.imageUrl;
  // Cropping edits the focal point/zoom of whichever entity owns the image — the linked
  // sheet portrait or item icon (the map renders that crop). A standalone token image has
  // no crop model (it uses the framed/raw toggle instead), so Crop is hidden there.
  const cropTarget: { crop: IconCrop; apply: (crop: IconCrop) => void } | null =
    linkedSheet?.data.iconUrl
      ? {
          crop: linkedSheet.data.iconCrop,
          apply: (iconCrop) => dm.updateSheet(linkedSheetId!, { iconCrop }),
        }
      : linkedItem?.iconUrl
        ? { crop: linkedItem.iconCrop, apply: (iconCrop) => dm.updateItem({ ...linkedItem, iconCrop }) }
        : null;

  const setControllingPlayer = (slotId: string) => {
    // A token already linked to an NPC sheet keeps that identity — assigning a player just hands
    // over control ("mind control"). A token without an NPC sheet becomes that player's PC.
    const linksNpcSheet = Boolean(token.sheetId && state.sheets[token.sheetId]?.kind === "npc");
    if (slotId === "") {
      if (linksNpcSheet) {
        // Mind-controlled NPC → control returns to the DM; its sheet/identity stay intact.
        dm.updateToken({ ...token, kind: "enemy", ownerPlayerId: null });
      } else {
        // A player character's identity all comes from its player (written in by
        // syncTokenFromState), so removing the player resets it to a blank DM enemy token.
        dm.updateToken({
          ...token,
          kind: "enemy",
          ownerPlayerId: null,
          sheetId: null,
          label: "",
          color: TOKEN_ENEMY_COLOR,
          imageUrl: null,
        });
      }
    } else if (linksNpcSheet) {
      // Keep it an NPC (kind "enemy" ⇒ the player sync won't overwrite its identity); just grant
      // the player control. The board shows a ring in their colour.
      dm.updateToken({ ...token, kind: "enemy", ownerPlayerId: slotId });
    } else {
      // A plain token assigned to a player becomes that player's character.
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

  // Write an image URL to the right place: a linked sheet's shared portrait, a linked
  // item's shared icon, or (unlinked) the token's own image. Shared by fresh uploads and
  // library reuse. A new picture resets the crop so the old focal point/zoom doesn't carry.
  const applyImageUrl = (url: string) => {
    if (linkedSheetId && linkedSheet) {
      dm.updateSheet(linkedSheetId, { iconUrl: url, iconCrop: { ...DEFAULT_ICON_CROP } });
    } else if (linkedItem) {
      dm.updateItem({ ...linkedItem, iconUrl: url, iconCrop: { ...DEFAULT_ICON_CROP } });
    } else {
      dm.updateToken({ ...token, imageUrl: url });
    }
  };

  const uploadImage = async (file: File) => {
    setUploading(true);
    try {
      if (linkedSheetId && linkedSheet) {
        const { url } = await uploadPortrait(state.roomId, linkedSheetId, file);
        applyImageUrl(url);
      } else if (linkedItem) {
        const { url } = await uploadTokenImage(state.roomId, linkedItem.id, file);
        applyImageUrl(url);
      } else {
        const { url } = await uploadTokenImage(state.roomId, token.id, file);
        applyImageUrl(url);
      }
    } catch {
      // Non-fatal: image stays unchanged.
    } finally {
      setUploading(false);
    }
  };

  const clearImage = () => {
    if (linkedSheetId && linkedSheet) {
      // Clear the shared portrait; also drop any legacy token image so it can't reappear.
      dm.updateSheet(linkedSheetId, { iconUrl: null });
      if (token.imageUrl) dm.updateToken({ ...token, imageUrl: null });
    } else if (linkedItem) {
      dm.updateItem({ ...linkedItem, iconUrl: null });
      if (token.imageUrl) dm.updateToken({ ...token, imageUrl: null });
    } else {
      dm.updateToken({ ...token, imageUrl: null });
    }
  };
  // The effective image (linked sheet's portrait, else the token's own) drives the
  // Change/Clear buttons and the fit toggle.
  const hasImage = Boolean(effectiveImage);

  return (
    // Hosted in a FloatingWindow (App.tsx) that supplies the title bar, close button,
    // dragging, and sizing — this renders only the scrollable body.
    <div className="panel">
      <div className="panel-body stack">
        <div className="field">
          <label>
            Label{isLinked ? " (from linked sheet/item — rename that to change this)" : ""}
          </label>
          <input
            defaultValue={token.label}
            key={token.id + token.label}
            disabled={isLinked}
            onBlur={(e) => dm.updateToken({ ...token, label: e.target.value })}
          />
        </div>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <label
            style={{ margin: 0 }}
            title="Show or hide this token's name caption on the board (affects everyone). The real name still appears in combat, the log, and here."
          >
            Name on board
          </label>
          <button
            className={token.nameHidden ? "btn-active" : ""}
            onClick={() => dm.updateToken({ ...token, nameHidden: !token.nameHidden })}
          >
            {token.nameHidden ? "Hidden" : "Shown"}
          </button>
        </div>
        <div className="row">
          <div style={{ flex: 1 }}>
            <label>Color</label>
            <input
              type="color"
              value={token.color}
              disabled={isPlayerChar}
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
            max={8}
            step={0.25}
            value={token.size ?? state.defaultTokenSize ?? DEFAULT_TOKEN_SIZE}
            disabled={token.size === undefined}
            onChange={(e) => dm.updateToken({ ...token, size: Number(e.target.value) })}
          />
        </div>

        <div className="field">
          <label>Facing</label>
          <div className="row">
            <input
              type="range"
              min={0}
              max={359}
              step={15}
              value={token.facing ?? 0}
              onChange={(e) => dm.updateToken({ ...token, facing: Number(e.target.value) })}
              aria-label="Facing degrees"
            />
            <span className="muted" style={{ minWidth: "3rem", textAlign: "right" }}>
              {token.facing === undefined ? "—" : `${Math.round(token.facing)}°`}
            </span>
            {token.facing !== undefined ? (
              <button
                className="btn-ghost"
                title="Clear facing arrow"
                onClick={() => dm.updateToken({ ...token, facing: undefined })}
              >
                ✕
              </button>
            ) : null}
          </div>
        </div>

        <div className="field">
          <label title={linkedSheet ? "Shared with the linked character sheet" : undefined}>
            {linkedSheet ? "Portrait" : "Token image"}
          </label>
          <div className="row">
            <button onClick={() => fileRef.current?.click()} disabled={uploading}>
              {uploading ? "Uploading…" : hasImage ? "Change" : "Upload"}
            </button>
            <button className="btn-ghost" title="Reuse an already-uploaded image" onClick={() => setLibOpen(true)}>
              Library
            </button>
            {hasImage && cropTarget ? (
              <button className="btn-ghost" title="Crop the portrait/icon focal point" onClick={() => setCropOpen(true)}>
                Crop
              </button>
            ) : null}
            {hasImage ? (
              <button className="btn-ghost" onClick={clearImage}>
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
          {libOpen ? (
            <AssetPickerModal
              roomId={state.roomId}
              title={linkedSheet ? "Choose a portrait" : "Choose a token image"}
              onPick={applyImageUrl}
              onClose={() => setLibOpen(false)}
            />
          ) : null}
          {cropOpen && effectiveImage && cropTarget ? (
            <ImageCropModal
              src={effectiveImage}
              crop={cropTarget.crop}
              frameAspect={PORTRAIT_ASPECT}
              title="Crop image"
              onApply={(iconCrop) => {
                cropTarget.apply(iconCrop);
                setCropOpen(false);
              }}
              onClose={() => setCropOpen(false)}
            />
          ) : null}
        </div>
        {hasImage ? (
          <div className="row" style={{ justifyContent: "space-between" }}>
            <label style={{ margin: 0 }} title="Show the bare image, or clip it inside the token shape">
              Image style
            </label>
            <button
              className={token.imageFit === "raw" ? "btn-active" : ""}
              onClick={() =>
                dm.updateToken(
                  token.imageFit === "raw"
                    ? // Facing spins the raw picture; back in a frame the portrait must sit
                      // upright again, so returning to framed also resets the facing.
                      { ...token, imageFit: "framed", facing: undefined }
                    : { ...token, imageFit: "raw" },
                )
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
              <label title="Which player controls this token. 'None' = DM-controlled. Assigning a player to a token that has an NPC sheet lets them move it while it keeps its own identity (mind control); a plain token becomes that player's character.">
                Controlled by
              </label>
              <select value={token.ownerPlayerId ?? ""} onChange={(e) => setControllingPlayer(e.target.value)}>
                <option value="">None — DM</option>
                {state.playerSlots.map((slot) => (
                  <option key={slot.id} value={slot.id}>
                    {slot.name}
                  </option>
                ))}
              </select>
            </div>
            {controlledNpc ? (
              <div className="muted" style={{ fontSize: "0.78rem", marginTop: "-0.2rem" }}>
                <Hand size={13} strokeWidth={2.2} /> {controllerSlot?.name} can move this NPC — it keeps its own name, colour, and
                portrait (shown ringed in their colour on the map).
              </div>
            ) : null}
            {isPlayerChar && token.ownerPlayerId ? (
              <button onClick={() => openSheet(token.ownerPlayerId!)}>Open sheet</button>
            ) : (
              <div className="field">
                <label title="Link an NPC stat block (HP, rolls, portrait) to this token. 'New' creates one; 'None' leaves it a plain token.">
                  Sheet
                </label>
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
            {token.sheetId && state.sheets[token.sheetId] ? (
              <div className="field">
                <label>Hit Points</label>
                <HpStepper
                  hp={state.sheets[token.sheetId]!.data.hp}
                  canEdit
                  onAdjust={(delta) => dm.adjustHp(token.sheetId!, delta)}
                  onSetHp={(hp) => dm.updateSheet(token.sheetId!, { hp })}
                />
              </div>
            ) : null}
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
              <label style={{ margin: 0 }} title="Leave this token out of the initiative order when combat starts — no d20, no turn. Use it for scenery, mounts, or anything you run on another combatant's turn.">
                Rolls initiative
              </label>
              <button
                className={token.noInitiative ? "btn-active" : ""}
                onClick={() => dm.updateToken({ ...token, noInitiative: !token.noInitiative })}
              >
                {token.noInitiative ? <><Ban size={13} strokeWidth={2.2} /> Skipped</> : "Yes"}
              </button>
            </div>
          </>
        )}

        {isPlayerChar ? (
          <div className="row" style={{ justifyContent: "space-between" }}>
            <label style={{ margin: 0 }}>Hidden from players</label>
            <button
              className={token.hidden ? "btn-active" : ""}
              title="Hidden tokens never reach player clients — you see them ghosted"
              onClick={() => dm.updateToken({ ...token, hidden: !token.hidden })}
            >
              {token.hidden ? <><EyeOff size={13} strokeWidth={2.2} /> Hidden</> : "Visible"}
            </button>
          </div>
        ) : (
          <>
            <div className="field">
              <label>Player visibility</label>
              <div className="row">
                <button
                  className={token.hidden ? "btn-active" : ""}
                  title="Never sent to player clients — you see it ghosted (hotkey: hover + H)"
                  onClick={() => dm.updateToken({ ...token, hidden: true, dmVisibility: undefined })}
                >
                  <EyeOff size={13} strokeWidth={2.2} /> Hidden
                </button>
                <button
                  className={!token.hidden && token.dmVisibility !== "always" ? "btn-active" : ""}
                  title="With dynamic lighting, each player's own vision decides: they see this token when it's lit, in line of sight, or within their darkvision"
                  onClick={() => dm.updateToken({ ...token, hidden: undefined, dmVisibility: undefined })}
                >
                  Auto
                </button>
                <button
                  className={!token.hidden && token.dmVisibility === "always" ? "btn-active" : ""}
                  title="Everyone sees this token even in darkness (the darkness overlay still dims it)"
                  onClick={() => dm.updateToken({ ...token, hidden: undefined, dmVisibility: "always" })}
                >
                  Always
                </button>
              </div>
            </div>
            {!token.hidden && token.dmVisibility !== "always" && state.playerSlots.length > 0 ? (
              <div className="field">
                <label>Reveal to specific players (even in darkness)</label>
                <div className="row" style={{ flexWrap: "wrap" }}>
                  {state.playerSlots.map((slot) => {
                    const revealed = token.revealTo?.includes(slot.id) ?? false;
                    return (
                      <button
                        key={slot.id}
                        className={revealed ? "btn-active" : ""}
                        title={
                          revealed
                            ? `${slot.name || "Player"} always sees this token — click to revert to their vision`
                            : `Show this token to ${slot.name || "Player"} even when their vision fails`
                        }
                        onClick={() => {
                          const next = revealed
                            ? (token.revealTo ?? []).filter((id) => id !== slot.id)
                            : [...(token.revealTo ?? []), slot.id];
                          dm.updateToken({ ...token, revealTo: next.length > 0 ? next : undefined });
                        }}
                      >
                        {slot.name || "Player"}
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}
            <div className="row" style={{ justifyContent: "space-between" }}>
              <label style={{ margin: 0 }}>Conceal name</label>
              <button
                className={token.nameConcealed ? "btn-active" : ""}
                title={'Players see "???" as this token\'s name everywhere (board, combat, log)'}
                onClick={() => dm.updateToken({ ...token, nameConcealed: !token.nameConcealed })}
              >
                {token.nameConcealed ? "??? ✓" : "Off"}
              </button>
            </div>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <label style={{ margin: 0 }}>Conceal portrait</label>
              <button
                className={token.portraitConcealed ? "btn-active" : ""}
                title={'Players see a "?" instead of this token\'s art'}
                onClick={() =>
                  dm.updateToken({ ...token, portraitConcealed: !token.portraitConcealed })
                }
              >
                {token.portraitConcealed ? "? ✓" : "Off"}
              </button>
            </div>
          </>
        )}

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
