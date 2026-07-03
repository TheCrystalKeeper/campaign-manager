import { useRef, useState } from "react";
import type { GameState, TokenTemplate, TokenTemplateCategory } from "../lib/types";
import {
  createTokenTemplate,
  TOKEN_COLORS,
  TOKEN_TEMPLATE_CATEGORIES,
  tokenFromTemplate,
} from "../lib/types";
import type { useDmActions } from "../hooks/useGameRoom";
import { uploadTokenImage } from "../lib/uploadAsset";

type TokenLibraryPanelProps = {
  state: GameState;
  dm: ReturnType<typeof useDmActions>;
};

/// <summary>
/// DM sidebar for creating, editing, and placing reusable map token templates.
/// </summary>
export function TokenLibraryPanel({ state, dm }: TokenLibraryPanelProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<TokenTemplate | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [filter, setFilter] = useState<TokenTemplateCategory | "all">("all");

  const activeScene = state.scenes.find((scene) => scene.id === state.activeSceneId);
  const templates = state.tokenTemplates ?? [];
  const filtered =
    filter === "all" ? templates : templates.filter((item) => item.category === filter);

  /// <summary>
  /// Opens the editor for a new library token.
  /// </summary>
  const startNew = () => {
    const template = createTokenTemplate();
    setSelectedId(template.id);
    setDraft(template);
    setUploadError(null);
  };

  /// <summary>
  /// Opens the editor for an existing library token.
  /// </summary>
  const startEdit = (template: TokenTemplate) => {
    setSelectedId(template.id);
    setDraft({ ...template });
    setUploadError(null);
  };

  /// <summary>
  /// Closes the token editor without saving.
  /// </summary>
  const clearEditor = () => {
    setSelectedId(null);
    setDraft(null);
    setUploadError(null);
  };

  /// <summary>
  /// Persists the current editor draft to the shared library.
  /// </summary>
  const saveDraft = () => {
    if (!draft) {
      return;
    }
    const exists = templates.some((item) => item.id === draft.id);
    if (exists) {
      dm.updateTokenTemplate(draft);
    } else {
      dm.addTokenTemplate(draft);
    }
    clearEditor();
  };

  /// <summary>
  /// Removes a template from the shared library.
  /// </summary>
  const deleteTemplate = (templateId: string) => {
    dm.removeTokenTemplate(templateId);
    if (selectedId === templateId) {
      clearEditor();
    }
  };

  /// <summary>
  /// Places a library token on the active scene.
  /// </summary>
  const placeTemplate = (template: TokenTemplate) => {
    if (!activeScene) {
      return;
    }
    dm.addToken(tokenFromTemplate(template, activeScene));
  };

  /// <summary>
  /// Uploads an image for the token currently being edited.
  /// </summary>
  const handleImageFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !draft) {
      return;
    }

    setUploadError(null);
    setUploading(true);
    try {
      const uploaded = await uploadTokenImage(draft.id, file);
      setDraft({ ...draft, imageUrl: uploaded.url });
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : "Image upload failed.");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="side-panel token-library-panel">
      <header className="side-panel-header">
        <h2>Tokens</h2>
        <button type="button" className="btn-compact" onClick={startNew}>
          + Token
        </button>
      </header>

      <div className="side-panel-body token-library-body">
        <p className="settings-hint token-library-intro">
          Save enemies, objects, and items here, then place them on the active scene (
          <strong>{activeScene?.name ?? "none"}</strong>).
        </p>

        <div className="token-library-toolbar">
          <label className="token-library-filter">
            <span className="token-library-filter-label">Filter</span>
            <select
              value={filter}
              onChange={(event) => setFilter(event.target.value as typeof filter)}
            >
              <option value="all">All types</option>
              {TOKEN_TEMPLATE_CATEGORIES.map((category) => (
                <option key={category.value} value={category.value}>
                  {category.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="token-library-content">
          {filtered.length === 0 ? (
            <p className="muted">No saved tokens yet. Create one to reuse across scenes.</p>
          ) : (
            <div className="token-library-grid">
              {filtered.map((template) => (
              <div
                key={template.id}
                className={`token-library-card${selectedId === template.id ? " selected" : ""}`}
              >
                <button
                  type="button"
                  className="token-library-card-select"
                  onClick={() => startEdit(template)}
                >
                  {template.imageUrl ? (
                    <img className="token-library-thumb" src={template.imageUrl} alt="" />
                  ) : (
                    <span
                      className="token-library-thumb token-library-thumb-empty"
                      style={{ borderColor: template.color }}
                    />
                  )}
                  <span className="token-library-card-body">
                    <span className="token-library-name">{template.name}</span>
                    <span className="token-library-meta">
                      {TOKEN_TEMPLATE_CATEGORIES.find((item) => item.value === template.category)
                        ?.label ?? template.category}{" "}
                      · {template.label}
                    </span>
                  </span>
                </button>
                <div className="token-library-card-actions">
                  <button type="button" onClick={() => placeTemplate(template)}>
                    Place
                  </button>
                  <button
                    type="button"
                    className="danger"
                    onClick={() => deleteTemplate(template.id)}
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
            </div>
          )}

          {draft ? (
            <section className="settings-section token-library-editor">
            <h3>{templates.some((item) => item.id === draft.id) ? "Edit token" : "New token"}</h3>
            <label className="settings-field">
              Library name
              <input
                value={draft.name}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                placeholder="Goblin, Chest, Magic sword…"
              />
            </label>
            <label className="settings-field">
              Map label
              <input
                value={draft.label}
                onChange={(event) => setDraft({ ...draft, label: event.target.value })}
                placeholder="Shown under the token on the map"
              />
            </label>
            <label className="settings-field">
              Type
              <select
                value={draft.category}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    category: event.target.value as TokenTemplateCategory,
                  })
                }
              >
                {TOKEN_TEMPLATE_CATEGORIES.map((category) => (
                  <option key={category.value} value={category.value}>
                    {category.label}
                  </option>
                ))}
              </select>
            </label>
            <div className="settings-field">
              Ring color
              <div className="color-presets">
                {TOKEN_COLORS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    className={`color-swatch${draft.color === color ? " active" : ""}`}
                    style={{ backgroundColor: color }}
                    aria-label={`Color ${color}`}
                    onClick={() => setDraft({ ...draft, color })}
                  />
                ))}
              </div>
            </div>
            <div className="token-add-image">
              <span className="token-add-field-label">Token image</span>
              {draft.imageUrl ? (
                <img className="token-add-preview" src={draft.imageUrl} alt="" />
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
                  {uploading ? "Uploading…" : draft.imageUrl ? "Change image" : "Upload image"}
                </button>
                {draft.imageUrl ? (
                  <button
                    type="button"
                    className="btn-compact"
                    onClick={() => setDraft({ ...draft, imageUrl: null })}
                  >
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
            <div className="settings-row">
              <button type="button" onClick={saveDraft}>
                Save to library
              </button>
              <button type="button" onClick={() => placeTemplate(draft)}>
                Place on map
              </button>
              <button type="button" className="btn-compact" onClick={clearEditor}>
                Cancel
              </button>
            </div>
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}
