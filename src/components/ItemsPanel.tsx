import { Directory, type DirectoryRowData } from "./Directory";
import type { GameState } from "../lib/types";
import type { useDmActions } from "../hooks/useGameRoom";

type ItemsPanelProps = {
  state: GameState;
  dm: ReturnType<typeof useDmActions>;
  /** Open the full Item Sheet window for an item. */
  openItemSheet: (itemId: string) => void;
  /** Place an "item" token on the map (drag an item onto the board). */
  dropItemAt: (itemId: string, clientX: number, clientY: number) => void;
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
export function ItemsPanel({ state, dm, openItemSheet, dropItemAt }: ItemsPanelProps) {
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
        openItemSheet(itemId);
      }}
      onCreateFolder={(name) =>
        dm.createFolder(
          newId("folder"),
          "item",
          name || nextName("Folder", state.folders.filter((f) => f.kind === "item").map((f) => f.name)),
        )
      }
      onRenameFolder={(folderId, name) => dm.renameFolder(folderId, name)}
      onMoveFolder={(folderId, sortOrder) => dm.moveFolder(folderId, sortOrder)}
      onDeleteFolder={(folderId) => dm.deleteFolder(folderId)}
      onMoveRow={(itemId, folderId, sortOrder) => {
        const item = state.items[itemId];
        if (item) {
          dm.updateItem({ ...item, folderId, sortOrder });
        }
      }}
      onExternalDrop={(itemId, element, x, y) => {
        // Onto the board → place an item token; onto a sheet's Inventory → hand out a copy.
        if (element?.closest(".map-root")) {
          dropItemAt(itemId, x, y);
        } else {
          dropOnSheet(itemId, element);
        }
      }}
      onRowClick={(itemId) => openItemSheet(itemId)}
      onDeleteSelected={(ids) => ids.forEach((id) => dm.deleteItem(id))}
      renderRowActions={(itemId) => (
        <>
          <button
            className="btn-ghost icon-btn"
            title="Duplicate item"
            onClick={() => dm.duplicateItem(itemId, newId("item"))}
          >
            ⧉
          </button>
          <button
            className="btn-ghost icon-btn"
            title="Delete item (sheet inventories keep their copies)"
            onClick={() => dm.deleteItem(itemId)}
          >
            ✕
          </button>
        </>
      )}
    />
  );
}
