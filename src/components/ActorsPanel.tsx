import { Directory, type DirectoryRowData } from "./Directory";
import { startPointerDrag } from "../lib/pointerDrag";
import { playerTokenColorForSlot, TOKEN_ENEMY_COLOR, type GameState } from "../lib/types";
import type { useDmActions } from "../hooks/useGameRoom";

type ActorsPanelProps = {
  state: GameState;
  dm: ReturnType<typeof useDmActions>;
  openSheet: (sheetId: string) => void;
  /** Drop an actor (or null for a blank token) onto the map at screen coords. */
  dropActorAt: (sheetId: string | null, clientX: number, clientY: number) => void;
  /** Restrict the directory to one kind (the NPCs page shows NPCs only). */
  filterKind?: "pc" | "npc";
  /**
   * Which folder tree to read/write: "actor" (Actors sidebar, default) or "npc"
   * (the NPCs page's own tree). NPC sheets carry an independent folder in each.
   */
  folderKind?: "actor" | "npc";
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

const byOrderThenName = (a: DirectoryRowData, b: DirectoryRowData) =>
  (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER) ||
  a.name.localeCompare(b.name);

/// <summary>
/// The Actors directory (PCs + NPCs): folders, search, quick create, manual
/// drag-reordering, and drag-to-board token placement.
/// </summary>
export function ActorsPanel({
  state,
  dm,
  openSheet,
  dropActorAt,
  filterKind,
  folderKind = "actor",
}: ActorsPanelProps) {
  const records = Object.values(state.sheets).filter(
    (record) => !filterKind || record.kind === filterKind,
  );
  // The NPCs page ("npc" tree) files sheets independently of the Actors sidebar ("actor" tree).
  const folderOf = (r: (typeof records)[number]) =>
    folderKind === "npc" ? (r.npcFolderId ?? null) : r.folderId;
  const orderOf = (r: (typeof records)[number]) =>
    folderKind === "npc" ? r.npcSortOrder : r.sortOrder;

  const rows: DirectoryRowData[] = records
    .map((record) =>
      record.kind === "pc"
        ? {
            id: record.id,
            name: record.data.characterName || "Character",
            iconUrl: record.data.iconUrl,
            color: playerTokenColorForSlot(record.id, state.playerSlots),
            badge: "PC",
            folderId: folderOf(record),
            order: orderOf(record),
          }
        : {
            id: record.id,
            name: record.data.characterName || "Unnamed NPC",
            iconUrl: record.data.iconUrl,
            color: TOKEN_ENEMY_COLOR,
            folderId: folderOf(record),
            order: orderOf(record),
          },
    )
    .sort(byOrderThenName);

  const dropOnBoard = (sheetId: string | null, element: Element | null, x: number, y: number) => {
    if (element?.closest(".map-root")) {
      dropActorAt(sheetId, x, y);
    }
  };

  return (
    <Directory
      kind="actor"
      folders={state.folders.filter((folder) => folder.kind === folderKind)}
      rows={rows}
      createLabel="Create NPC"
      // The combined Actors sidebar can also spin up a new player slot; the NPC-only page can't.
      onCreatePlayer={
        filterKind
          ? undefined
          : () => {
              const taken = new Set(state.playerSlots.map((slot) => slot.name));
              let n = 1;
              while (taken.has(`Player ${n}`)) n += 1;
              dm.addPlayerSlot(`Player ${n}`);
            }
      }
      onCreate={(name, folderId) => {
        const sheetId = newId("sheet");
        const finalName =
          name ||
          nextName(
            "NPC",
            records.filter((r) => r.kind === "npc").map((r) => r.data.characterName),
          );
        dm.createSheet(sheetId, finalName);
        // Messages are ordered, so the freshly-created sheet exists by the time
        // the server processes this folder move.
        if (folderId) {
          dm.setSheetFolder(sheetId, folderId, undefined, folderKind);
        }
        openSheet(sheetId);
      }}
      onCreateFolder={(name) =>
        dm.createFolder(
          newId("folder"),
          folderKind,
          name || nextName("Folder", state.folders.filter((f) => f.kind === folderKind).map((f) => f.name)),
        )
      }
      onRenameFolder={(folderId, name) => dm.renameFolder(folderId, name)}
      onMoveFolder={(folderId, sortOrder) => dm.moveFolder(folderId, sortOrder)}
      onDeleteFolder={(folderId) => dm.deleteFolder(folderId)}
      onMoveRow={(sheetId, folderId, sortOrder) =>
        dm.setSheetFolder(sheetId, folderId, sortOrder, folderKind)
      }
      onExternalDrop={dropOnBoard}
      onRowClick={(sheetId) => openSheet(sheetId)}
      onDeleteSelected={(ids) =>
        // Only NPC sheets can be deleted; player sheets are tied to slots.
        ids.forEach((id) => {
          if (state.sheets[id]?.kind === "npc") dm.deleteSheet(id);
        })
      }
      renderRowActions={(sheetId) => {
        const record = state.sheets[sheetId];
        if (!record || record.kind !== "npc") {
          return null;
        }
        return (
          <>
            <button
              className="btn-ghost icon-btn"
              title="Duplicate (own HP for goblin #2)"
              onClick={() => dm.duplicateSheet(sheetId, newId("sheet"))}
            >
              ⧉
            </button>
            <button
              className="btn-ghost icon-btn"
              title="Delete sheet (unlinks its tokens)"
              onClick={() => dm.deleteSheet(sheetId)}
            >
              ✕
            </button>
          </>
        );
      }}
      footer={
        // The blank-token chip drags onto the board; hide it on the prep page,
        // which sits over (and so covers) the board.
        filterKind ? undefined : (
          <div
            className="dir-row dir-blank-chip"
            title="Drag onto the map to place a plain token with no sheet"
            onPointerDown={(event) =>
              startPointerDrag(event, {
                label: "Blank token",
                onDrop: (drop) => dropOnBoard(null, drop.element, drop.clientX, drop.clientY),
              })
            }
          >
            <span className="dir-icon dir-dot" style={{ background: TOKEN_ENEMY_COLOR }} />
            <span className="dir-name muted">Blank token — drag onto the map</span>
          </div>
        )
      }
    />
  );
}
