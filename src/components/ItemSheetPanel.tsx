import { useRef, useState } from "react";
import { Backpack, BookOpen, Download, Upload } from "lucide-react";
import {
  DEFAULT_ICON_CROP,
  ITEM_RARITIES,
  ITEM_TYPES,
  PORTRAIT_ASPECT,
  type ItemRarity,
  type ItemRecord,
  type ItemType,
} from "../lib/types";
import { itemPatchFromEquipment, itemPatchFromMagicItem } from "../lib/compendiumMap";
import { downloadJson, itemExportPayload, parseItemImport, transferFilename } from "../lib/sheetTransfer";
import { uploadTokenImage } from "../lib/uploadAsset";
import { CroppableImage } from "./CroppableImage";
import { ImageCropModal } from "./ImageCropModal";
import { AssetPickerModal } from "./AssetPickerModal";
import { SrdItemPickerModal } from "./SrdItemPickerModal";

/** Compendium-managed optional fields, cleared before an apply so values from the item's
 *  previous identity (e.g. a magic item's rarity/attunement) don't survive under the new one. */
const COMPENDIUM_FIELD_RESET: Partial<ItemRecord> = {
  type: undefined,
  rarity: undefined,
  weight: undefined,
  value: undefined,
  attunement: undefined,
  damage: undefined,
  damageType: undefined,
  properties: undefined,
  equippable: undefined,
  toHit: undefined,
};

/// <summary>
/// Item Sheet: a compact editor for a catalog `ItemRecord` — icon, name, type, rarity,
/// quantity, weight, value, attunement, and description (Phase 6.7) plus the Phase 7
/// weapon fields (equippable, to-hit, damage, damage type, properties) that surface as a
/// sheet attack when the item is equipped. DM-only (roles ["dm"]); edits stream through
/// `onChange` → UPDATE_ITEM.
/// </summary>
export function ItemSheetPanel({
  item,
  roomId,
  onChange,
}: {
  item: ItemRecord;
  roomId: string;
  onChange: (item: ItemRecord) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [cropOpen, setCropOpen] = useState(false);
  const [libOpen, setLibOpen] = useState(false);
  const [srdOpen, setSrdOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const patch = (fields: Partial<ItemRecord>) => onChange({ ...item, ...fields });

  /** Overwrites this item's fields from a compendium pick, keeping its identity in the
   *  catalog (id, icon, folder, ordering, quantity). Placed board tokens re-sync their
   *  label/art automatically via UPDATE_ITEM. Returns false to keep the picker open. */
  const applyCompendium = (fields: Partial<ItemRecord> & { name: string }): boolean => {
    const hasContent = Boolean(item.description.trim() || item.type);
    if (
      hasContent &&
      !window.confirm(`Overwrite "${item.name}"'s fields with "${fields.name}" from the compendium?`)
    ) {
      return false;
    }
    patch({ ...COMPENDIUM_FIELD_RESET, ...fields });
    return true;
  };

  /** Import replaces the item's own fields but keeps its place in THIS catalog
   *  (folder + ordering come from the target, not the exported file). */
  const handleImport = (file: File) => {
    void file.text().then((text) => {
      try {
        const imported = parseItemImport(text, item.id);
        if (!window.confirm(`Replace "${item.name}" with "${imported.name}"? Every field is overwritten.`)) {
          return;
        }
        const { sortOrder: _dropped, ...fields } = imported;
        onChange({
          ...fields,
          folderId: item.folderId,
          ...(item.sortOrder !== undefined ? { sortOrder: item.sortOrder } : {}),
        });
      } catch (error) {
        window.alert(error instanceof Error ? error.message : "Could not read that file.");
      }
    });
  };

  const handleIcon = async (file: File) => {
    setUploading(true);
    try {
      const { url } = await uploadTokenImage(roomId, item.id, file);
      // Fresh image → reset the crop so the old focal point/zoom doesn't carry over.
      patch({ iconUrl: url, iconCrop: { ...DEFAULT_ICON_CROP } });
    } catch {
      // Non-fatal: icon stays unchanged.
    } finally {
      setUploading(false);
    }
  };

  const titleCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).replace("-", " ");

  return (
    <div className="panel-body stack">
      <div className="row" style={{ gap: "0.6rem", alignItems: "flex-start" }}>
        <div className="item-sheet-icon">
          {item.iconUrl ? (
            <CroppableImage
              src={item.iconUrl}
              crop={item.iconCrop}
              editable
              onChange={(iconCrop) => patch({ iconCrop })}
            />
          ) : (
            <span aria-hidden><Backpack size={22} strokeWidth={2.2} /></span>
          )}
        </div>
        <div className="stack" style={{ flex: 1 }}>
          <div className="field">
            <label>Name</label>
            <input
              key={item.id + item.name}
              defaultValue={item.name}
              onBlur={(e) => patch({ name: e.target.value.trim() || "Item" })}
            />
          </div>
          <div className="row">
            <button onClick={() => fileRef.current?.click()} disabled={uploading}>
              {uploading ? "Uploading…" : item.iconUrl ? "Change icon" : "Upload icon"}
            </button>
            <button className="btn-ghost" title="Reuse an already-uploaded image" onClick={() => setLibOpen(true)}>
              Library
            </button>
            {item.iconUrl ? (
              <button className="btn-ghost" onClick={() => setCropOpen(true)}>
                Crop
              </button>
            ) : null}
            {item.iconUrl ? (
              <button className="btn-ghost" onClick={() => patch({ iconUrl: null })}>
                Clear
              </button>
            ) : null}
            <button
              className="btn-ghost icon-btn icon-btn--accent"
              title="Apply a compendium item — overwrites this item's fields"
              onClick={() => setSrdOpen(true)}
            >
              <BookOpen size={14} strokeWidth={2.2} />
            </button>
            <span className="divider" />
            <button
              className="btn-ghost icon-btn"
              title="Export this item as a JSON file"
              onClick={() => downloadJson(transferFilename(item.name, "item"), itemExportPayload(item))}
            >
              <Download size={14} strokeWidth={2.2} />
            </button>
            <button
              className="btn-ghost icon-btn"
              title="Import an item from a JSON file — replaces this item"
              onClick={() => importRef.current?.click()}
            >
              <Upload size={14} strokeWidth={2.2} />
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              style={{ display: "none" }}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleIcon(file);
                e.target.value = "";
              }}
            />
            <input
              ref={importRef}
              type="file"
              accept="application/json,.json"
              style={{ display: "none" }}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleImport(file);
                e.target.value = "";
              }}
            />
          </div>
          {cropOpen && item.iconUrl ? (
            <ImageCropModal
              src={item.iconUrl}
              crop={item.iconCrop}
              frameAspect={PORTRAIT_ASPECT}
              title="Crop icon"
              onApply={(iconCrop) => {
                patch({ iconCrop });
                setCropOpen(false);
              }}
              onClose={() => setCropOpen(false)}
            />
          ) : null}
          {libOpen ? (
            <AssetPickerModal
              roomId={roomId}
              title="Choose an icon"
              onPick={(url) => patch({ iconUrl: url, iconCrop: { ...DEFAULT_ICON_CROP } })}
              onClose={() => setLibOpen(false)}
            />
          ) : null}
          {srdOpen ? (
            <SrdItemPickerModal
              title="Apply a compendium item"
              pickLabel="Apply"
              multiPick={false}
              onPickEquipment={(eq) => applyCompendium(itemPatchFromEquipment(eq))}
              onPickMagicItem={(mi) => applyCompendium(itemPatchFromMagicItem(mi))}
              onClose={() => setSrdOpen(false)}
            />
          ) : null}
        </div>
      </div>

      <div className="row">
        <div className="field" style={{ flex: 1 }}>
          <label>Type</label>
          <select
            value={item.type ?? ""}
            onChange={(e) => patch({ type: (e.target.value || undefined) as ItemType | undefined })}
          >
            <option value="">—</option>
            {ITEM_TYPES.map((t) => (
              <option key={t} value={t}>
                {titleCase(t)}
              </option>
            ))}
          </select>
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label>Rarity</label>
          <select
            value={item.rarity ?? ""}
            onChange={(e) =>
              patch({ rarity: (e.target.value || undefined) as ItemRarity | undefined })
            }
          >
            <option value="">—</option>
            {ITEM_RARITIES.map((r) => (
              <option key={r} value={r}>
                {titleCase(r)}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="row">
        <div className="field" style={{ flex: 1 }}>
          <label>Quantity</label>
          <input
            type="number"
            min={0}
            key={`q${item.id}${item.quantity ?? ""}`}
            defaultValue={item.quantity ?? ""}
            onBlur={(e) =>
              patch({ quantity: e.target.value === "" ? undefined : Math.max(0, Number(e.target.value) || 0) })
            }
          />
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label>Weight (lb)</label>
          <input
            type="number"
            min={0}
            step={0.1}
            key={`w${item.id}${item.weight ?? ""}`}
            defaultValue={item.weight ?? ""}
            onBlur={(e) =>
              patch({ weight: e.target.value === "" ? undefined : Math.max(0, Number(e.target.value) || 0) })
            }
          />
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label>Value</label>
          <input
            key={`v${item.id}${item.value ?? ""}`}
            defaultValue={item.value ?? ""}
            placeholder="50 gp"
            onBlur={(e) => patch({ value: e.target.value.trim() || undefined })}
          />
        </div>
      </div>

      <div className="row" style={{ justifyContent: "space-between" }}>
        <label style={{ margin: 0 }}>Requires attunement</label>
        <button
          className={item.attunement ? "btn-active" : ""}
          onClick={() => patch({ attunement: !item.attunement })}
        >
          {item.attunement ? "Yes" : "No"}
        </button>
      </div>

      <div className="row" style={{ justifyContent: "space-between" }}>
        <label style={{ margin: 0 }}>Equippable</label>
        <button
          className={item.equippable ? "btn-active" : ""}
          onClick={() => patch({ equippable: !item.equippable })}
        >
          {item.equippable ? "Yes" : "No"}
        </button>
      </div>

      <div className="row" style={{ justifyContent: "space-between" }}>
        <label
          style={{ margin: 0 }}
          title="Publishes this item to the compendium item picker's Homebrew tab — players can see and take it"
        >
          Show in item compendium
        </label>
        <button
          className={item.homebrew ? "btn-active" : ""}
          onClick={() => patch({ homebrew: !item.homebrew })}
        >
          {item.homebrew ? "Yes" : "No"}
        </button>
      </div>

      <div className="row">
        <div className="field" style={{ flex: 1 }}>
          <label>To hit</label>
          <input
            type="number"
            key={`th${item.id}${item.toHit ?? ""}`}
            defaultValue={item.toHit ?? ""}
            placeholder="+5"
            onBlur={(e) => patch({ toHit: e.target.value === "" ? undefined : Math.round(Number(e.target.value) || 0) })}
          />
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label>Damage</label>
          <input
            key={`dm${item.id}${item.damage ?? ""}`}
            defaultValue={item.damage ?? ""}
            placeholder="1d8+2"
            onBlur={(e) => patch({ damage: e.target.value.trim() || undefined })}
          />
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label>Damage type</label>
          <input
            key={`dt${item.id}${item.damageType ?? ""}`}
            defaultValue={item.damageType ?? ""}
            placeholder="slashing"
            onBlur={(e) => patch({ damageType: e.target.value.trim() || undefined })}
          />
        </div>
      </div>

      <div className="field">
        <label>Properties (comma-separated)</label>
        <input
          key={`pr${item.id}${(item.properties ?? []).join(",")}`}
          defaultValue={(item.properties ?? []).join(", ")}
          placeholder="Finesse, Light"
          onBlur={(e) => {
            const list = e.target.value.split(",").map((p) => p.trim()).filter(Boolean);
            patch({ properties: list.length ? list : undefined });
          }}
        />
      </div>

      <div className="field">
        <label>Description</label>
        <textarea
          key={`d${item.id}`}
          defaultValue={item.description}
          rows={6}
          onBlur={(e) => patch({ description: e.target.value })}
        />
      </div>
    </div>
  );
}
