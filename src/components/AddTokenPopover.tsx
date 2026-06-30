import { useEffect, useId, useRef, useState } from "react";
import type { GameState, Token, TokenKind, TokenTemplate } from "../lib/types";
import { playerTokenColorForSlot, TOKEN_ENEMY_COLOR } from "../lib/types";
import { uploadTokenImage } from "../lib/uploadAsset";
import type { useDmActions } from "../hooks/useGameRoom";

type AddTokenPopoverProps = {
  state: GameState;
  dm: ReturnType<typeof useDmActions>;
  anchorRef: React.RefObject<HTMLElement | null>;
  onClose: () => void;
};

/// <summary>
/// Popup form for placing player or enemy tokens with a name and optional image.
/// </summary>
export function AddTokenPopover({ state, dm, anchorRef, onClose }: AddTokenPopoverProps) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const formId = useId();
  const activeScene = state.scenes.find((scene) => scene.id === state.activeSceneId);
  const tokenIdRef = useRef(`token-${crypto.randomUUID().slice(0, 8)}`);

  const [kind, setKind] = useState<TokenKind>("player");
  const [label, setLabel] = useState("");
  const [ownerPlayerId, setOwnerPlayerId] = useState<string | null>(
    state.playerSlots[0]?.id ?? null,
  );
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [enemyColor, setEnemyColor] = useState(TOKEN_ENEMY_COLOR);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (popoverRef.current?.contains(target) || anchorRef.current?.contains(target)) {
        return;
      }
      onClose();
    };

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [anchorRef, onClose]);

  useEffect(() => {
    if (kind !== "player" || !ownerPlayerId) {
      return;
    }
    const slot = state.playerSlots.find((item) => item.id === ownerPlayerId);
    const sheet = state.characterSheets[ownerPlayerId];
    if (!slot) {
      return;
    }
    setLabel(sheet?.characterName?.trim() || slot.name);
    setImageUrl(sheet?.iconUrl ?? null);
  }, [kind, ownerPlayerId, state.playerSlots, state.characterSheets]);

  const handleKindChange = (nextKind: TokenKind) => {
    setKind(nextKind);
    setError(null);
    if (nextKind === "enemy") {
      setOwnerPlayerId(null);
      setEnemyColor(TOKEN_ENEMY_COLOR);
      if (!label.trim() || state.playerSlots.some((slot) => slot.name === label)) {
        setLabel("Enemy");
      }
      return;
    }
    const firstSlot = state.playerSlots[0];
    setOwnerPlayerId(firstSlot?.id ?? null);
  };

  const applyTemplate = (template: TokenTemplate) => {
    setKind("enemy");
    setOwnerPlayerId(null);
    setLabel(template.label);
    setImageUrl(template.imageUrl);
    setEnemyColor(template.color);
    setError(null);
  };

  const handleImageFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }

    setUploadError(null);
    setUploading(true);
    try {
      const uploaded = await uploadTokenImage(tokenIdRef.current, file);
      setImageUrl(uploaded.url);
    } catch (uploadFailure) {
      setUploadError(
        uploadFailure instanceof Error ? uploadFailure.message : "Image upload failed.",
      );
    } finally {
      setUploading(false);
    }
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!activeScene) {
      setError("No active scene.");
      return;
    }

    const trimmedLabel = label.trim();
    if (!trimmedLabel) {
      setError("Enter a token name.");
      return;
    }

    if (kind === "player" && !ownerPlayerId) {
      setError("Choose a player for this token.");
      return;
    }

    const token: Token = {
      id: tokenIdRef.current,
      sceneId: activeScene.id,
      x: activeScene.centerX ?? activeScene.width / 2,
      y: activeScene.centerY ?? activeScene.height / 2,
      label: trimmedLabel,
      kind,
      color:
        kind === "enemy"
          ? enemyColor
          : playerTokenColorForSlot(ownerPlayerId!, state.playerSlots),
      imageUrl,
      ownerPlayerId: kind === "player" ? ownerPlayerId : null,
    };

    dm.addToken(token);
    onClose();
  };

  return (
    <div
      ref={popoverRef}
      className="token-add-popover"
      role="dialog"
      aria-labelledby={`${formId}-title`}
      onMouseDown={(event) => event.stopPropagation()}
    >
      <header className="token-add-popover-header">
        <h3 id={`${formId}-title`}>Add token</h3>
        <button type="button" className="btn-compact" onClick={onClose} aria-label="Close">
          ×
        </button>
      </header>

      <form className="token-add-form" onSubmit={handleSubmit}>
        <fieldset className="token-kind-picker">
          <legend>Token type</legend>
          <label className="token-kind-option">
            <input
              type="radio"
              name={`${formId}-kind`}
              checked={kind === "player"}
              onChange={() => handleKindChange("player")}
            />
            Player
          </label>
          <label className="token-kind-option">
            <input
              type="radio"
              name={`${formId}-kind`}
              checked={kind === "enemy"}
              onChange={() => handleKindChange("enemy")}
            />
            Enemy
          </label>
        </fieldset>

        {kind === "enemy" && (state.tokenTemplates?.length ?? 0) > 0 ? (
          <label className="token-add-field">
            From library
            <select
              defaultValue=""
              onChange={(event) => {
                const template = state.tokenTemplates?.find(
                  (item) => item.id === event.target.value,
                );
                if (template) {
                  applyTemplate(template);
                }
                event.target.value = "";
              }}
            >
              <option value="">Choose a saved token…</option>
              {state.tokenTemplates?.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        <label className="token-add-field">
          Name
          <input
            value={label}
            onChange={(event) => {
              setLabel(event.target.value);
              setError(null);
            }}
            placeholder={kind === "enemy" ? "Goblin, Guard, …" : "Character name"}
          />
        </label>

        {kind === "player" ? (
          <label className="token-add-field">
            Player slot
            {state.playerSlots.length === 0 ? (
              <p className="muted token-add-hint">Create player slots in the Players tab first.</p>
            ) : (
              <select
                value={ownerPlayerId ?? ""}
                onChange={(event) => {
                  setOwnerPlayerId(event.target.value || null);
                  setError(null);
                }}
              >
                {state.playerSlots.map((slot) => (
                  <option key={slot.id} value={slot.id}>
                    {slot.name}
                  </option>
                ))}
              </select>
            )}
          </label>
        ) : null}

        <div className="token-add-image">
          <span className="token-add-field-label">Token image</span>
          {imageUrl ? (
            <img className="token-add-preview" src={imageUrl} alt="" />
          ) : (
            <div className="token-add-preview token-add-preview-empty">No image</div>
          )}
          <div className="token-add-image-actions">
            <button
              type="button"
              className="btn-compact"
              disabled={uploading}
              onClick={() => fileRef.current?.click()}
            >
              {uploading ? "Uploading…" : imageUrl ? "Change image" : "Upload image"}
            </button>
            {imageUrl ? (
              <button type="button" className="btn-compact" onClick={() => setImageUrl(null)}>
                Clear
              </button>
            ) : null}
          </div>
          <input
            ref={fileRef}
            className="file-input-hidden"
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            onChange={(event) => {
              void handleImageFile(event);
            }}
          />
          {uploadError ? <p className="token-add-error">{uploadError}</p> : null}
        </div>

        {error ? <p className="token-add-error">{error}</p> : null}

        <div className="token-add-actions">
          <button type="button" className="btn-compact" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            disabled={kind === "player" && state.playerSlots.length === 0}
          >
            Place token
          </button>
        </div>
      </form>
    </div>
  );
}
