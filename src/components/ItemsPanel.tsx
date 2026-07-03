import { useState } from "react";
import { Directory, type DirectoryRowData } from "./Directory";
import type { GameState } from "../lib/types";
import type { useDmActions } from "../hooks/useGameRoom";

type ItemsPanelProps = {
  state: GameState;
  dm: ReturnType<typeof useDmActions>;
};

const newId = (prefix: string) => `${prefix}-${crypto.randomUUID().slice(0, 8)}`;

/** Smallest unused "Prefix N" name, so quick-create needs no typing. */
const nextName = (prefix: string, taken: string[]) => {
  const set = new Set(taken);
  let n = 1;
  while (set.has(`${prefix} ${n}`)) {
    n += 1;
  }
  return `${prefix} ${n}`;
};

/// <summary>
/// The Items catalog: folders, search, quick create, manual drag-reordering,
/// inline editing, and drag-onto-a-sheet to hand items out (drop on the
/// Inventory section of any open character sheet).
/// </summary>
export function ItemsPanel({ state, dm }: ItemsPanelProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const rows: DirectoryRowData[] = Object.values(state.items)
    .map((item) => ({
      id: item.id,
      name: item.name,
      iconUrl: item.iconUrl,
      color: "var(--surface-2)",
      folderId: item.folderId,
      order: item.sortOrder,
    }))
    .sort(
      (a, b) =>
        (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER) ||
        a.name.localeCompare(b.name),
    );

  /** Dropping an item on a sheet's Inventory section hands out a copy. */
  const dropOnSheet = (itemId: string, element: Element | null) => {
    const zone = element?.closest("[data-inv-drop]");
    const sheetId = zone?.getAttribute("data-inv-drop");
    const item = state.items[itemId];
    const record = sheetId ? state.sheets[sheetId] : null;
    if (!item || !record) {
      return;
    }
    dm.updateSheet(record.id, {
      ...record.data,
      inventory: [
        ...record.data.inventory,
        { itemId: item.id, name: item.name, qty: 1, note: "" },
      ],
    });
  };

  return (
    <Directory
      kind="item"
      folders={state.folders.filter((folder) => folder.kind === "item")}
      rows={rows}
      createLabel="Create Item"
      onCreate={(name, folderId) => {
        const itemId = newId("item");
        const finalName = name || nextName("Item", Object.values(state.items).map((i) => i.name));
        dm.createItem(itemId, finalName);
        // Folder ＋ button: move the just-created item in (messages stay ordered).
        if (folderId) {
          dm.updateItem({ id: itemId, name: finalName, description: "", iconUrl: null, folderId });
        }
        setExpandedId(itemId);
      }}
      onCreateFolder={(name) =>
        dm.createFolder(
          newId("folder"),
          "item",
          name || nextName("Folder", state.folders.filter((f) => f.kind === "item").map((f) => f.name)),
        )
      }
      onRenameFolder={(folderId, name) => dm.renameFolder(folderId, name)}
      onDeleteFolder={(folderId) => dm.deleteFolder(folderId)}
      onMoveRow={(itemId, folderId, sortOrder) => {
        const item = state.items[itemId];
        if (item) {
          dm.updateItem({ ...item, folderId, sortOrder });
        }
      }}
      onExternalDrop={(itemId, element) => dropOnSheet(itemId, element)}
      onRowClick={(itemId) => setExpandedId((current) => (current === itemId ? null : itemId))}
      renderRowActions={(itemId) => (
        <button
          className="btn-ghost icon-btn"
          title="Delete item (sheet inventories keep their copies)"
          onClick={() => dm.deleteItem(itemId)}
        >
          ✕
        </button>
      )}
      renderExpanded={(itemId) => {
        if (itemId !== expandedId) {
          return null;
        }
        const item = state.items[itemId];
        if (!item) {
          return null;
        }
        return (
          <div className="dir-item-editor stack" key={item.id}>
            <input
              defaultValue={item.name}
              aria-label="Item name"
              onBlur={(e) => {
                const name = e.target.value.trim();
                if (name && name !== item.name) {
                  dm.updateItem({ ...item, name });
                }
              }}
            />
            <textarea
              defaultValue={item.description}
              placeholder="Description…"
              onBlur={(e) => {
                if (e.target.value !== item.description) {
                  dm.updateItem({ ...item, description: e.target.value });
                }
              }}
            />
          </div>
        );
      }}
    />
  );
}
