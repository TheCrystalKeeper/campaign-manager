import { useRef, useState, type ReactNode } from "react";
import { ArrowUpDown, Backpack, Folder as FolderIcon, FolderPlus, Search, Trash2, User, UserPlus } from "lucide-react";
import { startPointerDrag, wasRecentDrag, type PointerDrop } from "../lib/pointerDrag";
import { DEFAULT_ICON_CROP, type Folder, type IconCrop } from "../lib/types";
import { CroppableImage } from "./CroppableImage";

export type DirectoryRowData = {
  id: string;
  name: string;
  iconUrl?: string | null;
  /** Crop (focal point + zoom) applied to the icon; defaults to centered. */
  iconCrop?: IconCrop;
  /** Fallback avatar color when there is no icon. */
  color?: string;
  /** Small tag rendered after the name (e.g. "PC"). */
  badge?: string;
  folderId: string | null;
  /** Manual sort position within its folder (unset sorts last). */
  order?: number;
};

type DirectoryProps = {
  kind: Folder["kind"];
  folders: Folder[];
  /** Pre-sorted rows (panels sort by order, then name). */
  rows: DirectoryRowData[];
  createLabel: string;
  /** Create a row, optionally directly inside a folder (the folder's ＋ button). */
  onCreate: (name: string, folderId?: string | null) => void;
  onCreateFolder: (name: string) => void;
  /** Optional extra create action (Actors sidebar: "Create Player" → new slot). */
  onCreatePlayer?: () => void;
  onRenameFolder: (folderId: string, name: string) => void;
  /** Reorder a folder among its siblings (drag a folder header onto another). */
  onMoveFolder?: (folderId: string, sortOrder: number) => void;
  onDeleteFolder: (folderId: string) => void;
  /** Row dropped into a folder (or root) and/or reordered. */
  onMoveRow: (rowId: string, folderId: string | null, sortOrder: number) => void;
  /** Row dropped outside the directory (the map, a sheet, …). */
  onExternalDrop?: (rowId: string, element: Element | null, clientX: number, clientY: number) => void;
  onRowClick?: (rowId: string) => void;
  /** Bulk action for a multi-selection (marquee / ctrl-click). Enables the selection bar. */
  onDeleteSelected?: (rowIds: string[]) => void;
  renderRowActions?: (rowId: string) => ReactNode;
  /** Inline expansion under a row (e.g. the item editor). */
  renderExpanded?: (rowId: string) => ReactNode;
  footer?: ReactNode;
};

/// <summary>
/// Monotone display positions for a group of rows: explicit orders are
/// respected, unset ones continue after the previous row. Insertion midpoints
/// computed against these stay consistent even for never-ordered rows.
/// </summary>
function effectiveOrders(rows: DirectoryRowData[]): Map<string, number> {
  const map = new Map<string, number>();
  let prev = 0;
  for (const row of rows) {
    const eff =
      typeof row.order === "number" ? Math.max(row.order, prev + 1e-9) : prev + 1024;
    map.set(row.id, eff);
    prev = eff;
  }
  return map;
}

/** Per-kind glyph for the create button + empty-row avatar. */
function kindGlyph(kind: Folder["kind"]): ReactNode {
  return kind === "item" ? <Backpack size={15} strokeWidth={2.2} /> : <User size={15} strokeWidth={2.2} />;
}

/// <summary>
/// FoundryVTT-style directory: labeled create buttons, search, collapsible
/// folders with per-folder create, portrait rows, and pointer-based
/// drag-and-drop — drag rows onto folders/root to organize, onto other rows to
/// reorder, or out of the panel entirely (map, sheets).
/// </summary>
export function Directory({
  kind,
  folders,
  rows,
  createLabel,
  onCreate,
  onCreateFolder,
  onCreatePlayer,
  onRenameFolder,
  onMoveFolder,
  onDeleteFolder,
  onMoveRow,
  onExternalDrop,
  onRowClick,
  onDeleteSelected,
  renderRowActions,
  renderExpanded,
  footer,
}: DirectoryProps) {
  const [search, setSearch] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [sortAZ, setSortAZ] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [marquee, setMarquee] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const hoverRef = useRef<Element | null>(null);

  const clearSelection = () => setSelected((cur) => (cur.size ? new Set() : cur));

  /** Drag-select: rubber-band on empty directory space selects intersecting rows. */
  const beginMarquee = (event: React.PointerEvent) => {
    if (
      event.button !== 0 ||
      (event.target as Element).closest(
        "[data-dir-row], [data-dir-drop], .dir-folder, button, input, textarea, select",
      )
    ) {
      return;
    }
    const container = containerRef.current;
    if (!container) return;
    const additive = event.shiftKey || event.ctrlKey || event.metaKey;
    const base = additive ? new Set(selected) : new Set<string>();
    const startX = event.clientX;
    const startY = event.clientY;
    let moved = false;

    const onMove = (ev: PointerEvent) => {
      const left = Math.min(startX, ev.clientX);
      const top = Math.min(startY, ev.clientY);
      const w = Math.abs(ev.clientX - startX);
      const h = Math.abs(ev.clientY - startY);
      if (w > 3 || h > 3) moved = true;
      const cRect = container.getBoundingClientRect();
      // The marquee is absolutely-positioned inside the (scrollable) container, so add its
      // scroll offset — otherwise the box drifts from the cursor once the list is scrolled.
      setMarquee({
        x: left - cRect.left + container.scrollLeft,
        y: top - cRect.top + container.scrollTop,
        w,
        h,
      });
      const box = { left, top, right: left + w, bottom: top + h };
      const next = new Set(base);
      container.querySelectorAll("[data-dir-row]").forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.left < box.right && r.right > box.left && r.top < box.bottom && r.bottom > box.top) {
          next.add(el.getAttribute("data-dir-row")!);
        }
      });
      setSelected(next);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      setMarquee(null);
      if (!moved && !additive) clearSelection(); // a plain click on empty space clears
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const setDragging = (on: boolean) =>
    containerRef.current?.classList.toggle("dir--dragging", on);

  const setHover = (element: Element | null) => {
    const container = containerRef.current;
    const candidate = element?.closest("[data-dir-drop], [data-dir-row]") ?? null;
    const valid = candidate && container?.contains(candidate) ? candidate : null;
    if (hoverRef.current !== valid) {
      hoverRef.current?.classList.remove("drop-hover");
      valid?.classList.add("drop-hover");
      hoverRef.current = valid;
    }
  };

  const groupRows = (folderId: string | null) =>
    rows.filter((row) => row.folderId === folderId);

  /** Display order: manual (given) unless the A–Z toggle is on. */
  const displayed = (list: DirectoryRowData[]) =>
    sortAZ ? [...list].sort((a, b) => a.name.localeCompare(b.name)) : list;

  /** Resolve a pointer-drag release into a folder move, a reorder, or an external drop.
   *  `rowIds` is >1 when a multi-selection is dragged together. */
  const handleRowDrop = (rowIds: string[], drop: PointerDrop) => {
    const container = containerRef.current;
    const el = drop.element;
    const dragSet = new Set(rowIds);

    const folderTarget = el?.closest("[data-dir-drop]");
    if (folderTarget && container?.contains(folderTarget)) {
      const value = folderTarget.getAttribute("data-dir-drop")!;
      const folderId = value === "root" ? null : value;
      const group = groupRows(folderId).filter((row) => !dragSet.has(row.id));
      const effs = effectiveOrders(group);
      let last = group.length > 0 ? effs.get(group[group.length - 1].id)! : 0;
      for (const id of rowIds) {
        last += 1024;
        onMoveRow(id, folderId, last);
      }
      return;
    }

    const rowTarget = el?.closest("[data-dir-row]");
    if (rowTarget && container?.contains(rowTarget)) {
      const targetId = rowTarget.getAttribute("data-dir-row")!;
      const target = rows.find((row) => row.id === targetId);
      if (!target || dragSet.has(targetId)) {
        return;
      }
      const group = groupRows(target.folderId).filter((row) => !dragSet.has(row.id));
      const effs = effectiveOrders(group);
      if (rowIds.length > 1) {
        // Multi: drop the whole selection into the target's folder, appended.
        let last = group.length > 0 ? effs.get(group[group.length - 1].id)! : 0;
        for (const id of rowIds) {
          last += 1024;
          onMoveRow(id, target.folderId, last);
        }
        return;
      }
      const rect = rowTarget.getBoundingClientRect();
      const before = drop.clientY < rect.top + rect.height / 2;
      const targetIndex = group.findIndex((row) => row.id === targetId);
      const insertAt = before ? targetIndex : targetIndex + 1;
      const prev = insertAt > 0 ? effs.get(group[insertAt - 1].id)! : null;
      const next = insertAt < group.length ? effs.get(group[insertAt].id)! : null;
      const sortOrder =
        prev !== null && next !== null
          ? (prev + next) / 2
          : prev !== null
            ? prev + 1024
            : next !== null
              ? next - 1024
              : 1024;
      onMoveRow(rowIds[0], target.folderId, sortOrder);
      return;
    }

    // External drop (map / sheet inventory): fan multiples out so they don't stack.
    rowIds.forEach((id, i) =>
      onExternalDrop?.(id, el, drop.clientX + i * 28, drop.clientY + i * 28),
    );
  };

  // Folders render in manual order (drag a folder header onto another to reorder).
  const sortedFolders = [...folders].sort(
    (a, b) =>
      (a.sortOrder ?? Number.MAX_SAFE_INTEGER) - (b.sortOrder ?? Number.MAX_SAFE_INTEGER) ||
      a.name.localeCompare(b.name),
  );

  /** Resolve a folder-header drag release into a reorder among sibling folders. */
  const handleFolderDrop = (folderId: string, drop: PointerDrop) => {
    const container = containerRef.current;
    const targetEl = drop.element?.closest("[data-dir-drop]");
    if (!targetEl || !container?.contains(targetEl)) return;
    const targetId = targetEl.getAttribute("data-dir-drop")!;
    if (targetId === "root" || targetId === folderId) return;
    const siblings = sortedFolders.filter((f) => f.id !== folderId);
    const targetIndex = siblings.findIndex((f) => f.id === targetId);
    if (targetIndex < 0) return;
    // Monotone effective orders (mirror row reordering).
    const effs = new Map<string, number>();
    let prev = 0;
    for (const f of siblings) {
      const eff = typeof f.sortOrder === "number" ? Math.max(f.sortOrder, prev + 1e-9) : prev + 1024;
      effs.set(f.id, eff);
      prev = eff;
    }
    const rect = targetEl.getBoundingClientRect();
    const before = drop.clientY < rect.top + rect.height / 2;
    const insertAt = before ? targetIndex : targetIndex + 1;
    const p = insertAt > 0 ? effs.get(siblings[insertAt - 1].id)! : null;
    const n = insertAt < siblings.length ? effs.get(siblings[insertAt].id)! : null;
    const sortOrder =
      p !== null && n !== null ? (p + n) / 2 : p !== null ? p + 1024 : n !== null ? n - 1024 : 1024;
    onMoveFolder?.(folderId, sortOrder);
  };

  const query = search.trim().toLowerCase();
  const matches = (row: DirectoryRowData) => row.name.toLowerCase().includes(query);

  const toggleFolder = (id: string) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });

  const allCollapsed = folders.length > 0 && folders.every((folder) => collapsed.has(folder.id));
  const toggleAllFolders = () =>
    setCollapsed(allCollapsed ? new Set() : new Set(folders.map((folder) => folder.id)));

  const glyph = kindGlyph(kind);

  const renderRow = (row: DirectoryRowData) => {
    const isSelected = selected.has(row.id);
    // No icon (or a broken/deleted one) → the name's capitalized initial in the row's colour,
    // rather than a generic glyph or the browser's broken-image icon.
    const letterDot = (
      <span className="dir-icon dir-dot" style={{ background: row.color ?? "var(--surface-2)" }}>
        {row.name.trim().charAt(0).toUpperCase() || glyph}
      </span>
    );
    return (
    <div key={row.id}>
      <div
        className={`dir-row${isSelected ? " dir-row--selected" : ""}`}
        data-dir-row={row.id}
        onPointerDown={(event) => {
          if ((event.target as Element).closest("button, input, textarea, select")) {
            return;
          }
          // Dragging a row that's part of a multi-selection drags the whole selection.
          const dragIds = isSelected && selected.size > 1 ? [...selected] : [row.id];
          startPointerDrag(event, {
            label: dragIds.length > 1 ? `${dragIds.length} selected` : row.name,
            onStart: () => setDragging(true),
            onHover: setHover,
            onDrop: (drop) => handleRowDrop(dragIds, drop),
            onEnd: () => setDragging(false),
          });
        }}
        onClick={(event) => {
          if (wasRecentDrag()) return;
          if (event.shiftKey || event.ctrlKey || event.metaKey) {
            setSelected((cur) => {
              const next = new Set(cur);
              if (next.has(row.id)) {
                next.delete(row.id);
              } else {
                next.add(row.id);
              }
              return next;
            });
            return;
          }
          clearSelection();
          onRowClick?.(row.id);
        }}
      >
        {row.iconUrl ? (
          <CroppableImage
            className="dir-icon"
            src={row.iconUrl}
            crop={row.iconCrop ?? DEFAULT_ICON_CROP}
            alt=""
            fallback={letterDot}
          />
        ) : (
          letterDot
        )}
        <span className="dir-name">{row.name}</span>
        {row.badge ? <span className="dir-badge">{row.badge}</span> : null}
        <span className="dir-actions" onClick={(event) => event.stopPropagation()}>
          {renderRowActions?.(row.id)}
        </span>
      </div>
      {renderExpanded?.(row.id)}
    </div>
    );
  };

  const marqueeBox = marquee ? (
    <div
      className="dir-marquee"
      style={{ left: marquee.x, top: marquee.y, width: marquee.w, height: marquee.h }}
    />
  ) : null;

  /** The toolbar (create buttons + search) — shared by the flat and foldered views. */
  const toolbar = (
    <>
      <div className="dir-toolbar">
        <button className="dir-create" title={createLabel} onClick={() => onCreate("")}>
          <span className="dir-create-ico">{glyph}</span>
          {createLabel}
        </button>
        {onCreatePlayer ? (
          <button className="dir-create" title="Create a player slot" onClick={onCreatePlayer}>
            <span className="dir-create-ico"><UserPlus size={15} strokeWidth={2.2} /></span>
            Create Player
          </button>
        ) : null}
        <button
          className="dir-create dir-create--folder"
          title="Create a folder"
          onClick={() => onCreateFolder("")}
        >
          <span className="dir-create-ico"><FolderPlus size={15} strokeWidth={2.2} /></span>
          Create Folder
        </button>
      </div>
      {/* When rows are multi-selected, this row becomes the action bar (same slot → the
          folders below don't shift). Otherwise it's the search + sort/collapse controls. */}
      {selected.size > 0 ? (
        <div className="dir-search dir-selbar">
          <span className="dir-selcount">{selected.size} selected</span>
          <span style={{ flex: 1 }} />
          {onDeleteSelected ? (
            <button
              className="btn-danger"
              onClick={() => {
                onDeleteSelected([...selected]);
                setSelected(new Set());
              }}
            >
              <Trash2 size={13} strokeWidth={2.2} /> Delete
            </button>
          ) : null}
          <button onClick={clearSelection}>Clear</button>
        </div>
      ) : (
        <div className="dir-search">
          <span className="dir-search-ico"><Search size={13} strokeWidth={2.2} /></span>
          <input
            value={search}
            placeholder={`Search ${kind}s`}
            onChange={(e) => setSearch(e.target.value)}
          />
          <button
            className={`dir-icon-btn${sortAZ ? " dir-icon-btn--on" : ""}`}
            title={sortAZ ? "Sorting A–Z (click for manual order)" : "Sort A–Z"}
            onClick={() => setSortAZ((v) => !v)}
          >
            <ArrowUpDown size={14} strokeWidth={2.2} />
          </button>
          {folders.length > 0 ? (
            <button
              className="dir-icon-btn"
              title={allCollapsed ? "Expand all folders" : "Collapse all folders"}
              onClick={toggleAllFolders}
            >
              {allCollapsed ? "⊞" : "⊟"}
            </button>
          ) : null}
        </div>
      )}
    </>
  );

  // While searching, show a flat filtered list (folders ignored).
  if (query) {
    const found = displayed(rows.filter(matches));
    return (
      <div className="panel-body dir" ref={containerRef}>
        {toolbar}
        <div className="dir-list" onPointerDown={beginMarquee}>
          {found.length === 0 ? (
            <span className="muted dir-empty">No matches.</span>
          ) : (
            found.map(renderRow)
          )}
        </div>
        {marqueeBox}
      </div>
    );
  }

  const rootRows = displayed(rows.filter((row) => row.folderId === null));

  return (
    <div className="panel-body dir" ref={containerRef}>
      {toolbar}

      <div className="dir-list" onPointerDown={beginMarquee}>
        {folders.length > 0 ? (
          <div className="dir-root-drop" data-dir-drop="root">
            ⤒ Root — drop here to move out of a folder
          </div>
        ) : null}

        {sortedFolders.map((folder) => {
          const memberRows = displayed(rows.filter((row) => row.folderId === folder.id));
          const isCollapsed = collapsed.has(folder.id);
          return (
            <div className="dir-group" key={folder.id}>
              <div
                className="dir-folder"
                data-dir-drop={folder.id}
                onPointerDown={(event) => {
                  if (!onMoveFolder) return;
                  const target = event.target as HTMLElement;
                  // Buttons act on click. The name field drags too — UNLESS it's already
                  // focused for editing (then let it handle the caret / text selection).
                  // A plain click never moves past the drag threshold, so it still focuses
                  // the name to rename.
                  if (
                    target.closest("button") ||
                    (target.tagName === "INPUT" && target === document.activeElement)
                  ) {
                    return;
                  }
                  startPointerDrag(event, {
                    label: folder.name,
                    onStart: () => {
                      setDragging(true);
                      // Don't leave the name field focused while dragging.
                      (document.activeElement as HTMLElement | null)?.blur?.();
                    },
                    onHover: setHover,
                    onDrop: (drop) => handleFolderDrop(folder.id, drop),
                    onEnd: () => setDragging(false),
                  });
                }}
              >
                <button
                  className="dir-folder-toggle"
                  title={isCollapsed ? "Expand" : "Collapse"}
                  onClick={() => toggleFolder(folder.id)}
                >
                  {isCollapsed ? "▸" : "▾"}
                </button>
                <span className="dir-folder-ico"><FolderIcon size={14} strokeWidth={2.2} /></span>
                <input
                  className="dir-folder-name"
                  key={folder.id + folder.name}
                  defaultValue={folder.name}
                  title="Folder name (edit to rename)"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.currentTarget.blur();
                    } else if (e.key === "Escape") {
                      e.currentTarget.value = folder.name;
                      e.currentTarget.blur();
                    }
                  }}
                  onBlur={(e) => {
                    const name = e.target.value.trim();
                    if (name && name !== folder.name) {
                      onRenameFolder(folder.id, name);
                    }
                  }}
                />
                <span className="dir-folder-count">{memberRows.length}</span>
                <button
                  className="dir-icon-btn"
                  title={`${createLabel} in this folder`}
                  onClick={() => onCreate("", folder.id)}
                >
                  ＋
                </button>
                <button
                  className="dir-icon-btn"
                  title="Delete folder (contents move to root)"
                  onClick={() => onDeleteFolder(folder.id)}
                >
                  ✕
                </button>
              </div>
              {isCollapsed ? null : (
                <div className="dir-folder-body">{memberRows.map(renderRow)}</div>
              )}
            </div>
          );
        })}

        {rootRows.map(renderRow)}
        {rows.length === 0 ? <span className="muted dir-empty">Nothing here yet.</span> : null}
        {footer}
      </div>
      {marqueeBox}
    </div>
  );
}
