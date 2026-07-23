import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Search } from "lucide-react";
import { COMPENDIUM_ATTRIBUTION, searchCompendium } from "../lib/compendium";
import { isConfirmActionOpen } from "./ConfirmActionDialog";
import { clampNum, clampSizeToViewport, clampToViewport, CLAMP_MARGIN } from "../lib/clampToViewport";

/// <summary>
/// Shared "browse the compendium" picker: search box (+ optional filter controls),
/// a two-pane body (result list left, full-text preview right), an optional footer
/// for per-category controls (autofill checkboxes etc.), and the attribution
/// line. Same portal/backdrop/Esc pattern as AssetPickerModal.
/// `multiPick` keeps the modal open after Add so several entries can be grabbed
/// in one visit (added rows get a ✓).
/// Draggable (via the header) and resizable (edge/corner handles), same math as
/// FloatingWindow; geometry starts `null` (CSS-centered default) and switches to
/// a fixed rect on first drag/resize — not persisted, each open starts centered.
/// </summary>

export type PickerColumn<T> = {
  label: string;
  render: (row: T) => ReactNode;
  /** Value to sort by when this column's header is clicked; defaults to `render`'s output
   *  (every current column already renders a plain string). Override for columns whose
   *  display text doesn't sort correctly as text (e.g. CR fractions, dice sizes). */
  sortValue?: (row: T) => string | number;
};

type Geom = { x: number; y: number; w: number; h: number };
type ResizeDir = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
const RESIZE_DIRS: ResizeDir[] = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];
const MIN_W = 480;
const MIN_H = 320;

export function CompendiumPickerModal<T extends { id: string; name: string }>({
  title,
  load,
  getSearchText,
  columns,
  renderPreview,
  filters,
  filterFn,
  footer,
  badge,
  pickLabel = "Add",
  multiPick = false,
  initialSelectedId,
  onPick,
  onClose,
  onSelect,
}: {
  title: string;
  load: () => Promise<T[]>;
  /** Extra searchable text beyond the name (e.g. school, type). */
  getSearchText?: (row: T) => string;
  columns: PickerColumn<T>[];
  renderPreview: (row: T) => ReactNode;
  /** Optional filter controls rendered beside the search box. */
  filters?: ReactNode;
  /** Row predicate applied before search (wire to the `filters` controls). */
  filterFn?: (row: T) => boolean;
  /** Extra controls above the action row (e.g. the autofill checkbox). */
  footer?: ReactNode;
  /** Small pill rendered after the row name (e.g. "Homebrew"); null/undefined = none. */
  badge?: (row: T) => string | null | undefined;
  pickLabel?: string;
  multiPick?: boolean;
  /** Row to pre-highlight on open (e.g. the sheet's current choice). */
  initialSelectedId?: string;
  /** Return `false` to keep the modal open after a pick (e.g. a cancelled confirm). */
  onPick: (row: T) => void | boolean | Promise<void | boolean>;
  onClose: () => void;
  /** Notifies the host when the highlighted row changes (drives footer state). */
  onSelect?: (row: T | null) => void;
}) {
  const [rows, setRows] = useState<T[] | null>(null);
  const [error, setError] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId ?? null);
  const [addedIds, setAddedIds] = useState<Set<string>>(new Set());
  const listRef = useRef<HTMLDivElement>(null);
  // Guards the one-time onSelect for the pre-highlighted row once data loads.
  const notifiedInitial = useRef(false);

  // Drag/resize geometry — null means "use the default CSS-centered size" (not persisted;
  // every fresh open starts centered again). Set on first drag/resize, from the modal's
  // actual on-screen rect at that moment, so the switch to fixed positioning is seamless.
  const rootRef = useRef<HTMLDivElement>(null);
  const [geom, setGeom] = useState<Geom | null>(null);
  const dragRef = useRef<{ pointerId: number; offsetX: number; offsetY: number; w: number; h: number } | null>(null);
  const resizeRef = useRef<{ dir: ResizeDir; startX: number; startY: number; start: Geom } | null>(null);

  const currentRect = (): Geom => {
    if (geom) return geom;
    const r = rootRef.current!.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  };

  const startDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest("button")) return;
    const rect = currentRect();
    dragRef.current = {
      pointerId: event.pointerId,
      offsetX: event.clientX - rect.x,
      offsetY: event.clientY - rect.y,
      w: rect.w,
      h: rect.h,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onDragMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d) return;
    const size = clampSizeToViewport({ w: d.w, h: d.h });
    const pos = clampToViewport({ x: event.clientX - d.offsetX, y: event.clientY - d.offsetY }, size);
    setGeom({ x: pos.x, y: pos.y, w: size.w, h: size.h });
  };
  const endDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const startResize = (dir: ResizeDir) => (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    resizeRef.current = { dir, startX: event.clientX, startY: event.clientY, start: currentRect() };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onResizeMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const r = resizeRef.current;
    if (!r) return;
    const dx = event.clientX - r.startX;
    const dy = event.clientY - r.startY;
    let { x, y, w, h } = r.start;
    if (r.dir.includes("e")) {
      w = clampNum(r.start.w + dx, MIN_W, window.innerWidth - x - CLAMP_MARGIN);
    }
    if (r.dir.includes("w")) {
      const next = clampNum(r.start.w - dx, MIN_W, r.start.x + r.start.w - CLAMP_MARGIN);
      x = r.start.x + (r.start.w - next);
      w = next;
    }
    if (r.dir.includes("s")) {
      h = clampNum(r.start.h + dy, MIN_H, window.innerHeight - y - CLAMP_MARGIN);
    }
    if (r.dir.includes("n")) {
      const next = clampNum(r.start.h - dy, MIN_H, r.start.y + r.start.h - CLAMP_MARGIN);
      y = r.start.y + (r.start.h - next);
      h = next;
    }
    setGeom({ x, y, w, h });
  };
  const endResize = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!resizeRef.current) return;
    resizeRef.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
  };

  // Keep the modal on-screen if the browser window itself is resized (rule #7 — see
  // clampToViewport.ts); a no-op while geom is still null (default CSS-centered state).
  useEffect(() => {
    const onResize = () => {
      setGeom((current) => {
        if (!current) return current;
        const size = clampSizeToViewport({ w: current.w, h: current.h });
        const pos = clampToViewport({ x: current.x, y: current.y }, size);
        return { x: pos.x, y: pos.y, w: size.w, h: size.h };
      });
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const fetchRows = () => {
    setError(false);
    setRows(null);
    load().then(setRows, () => setError(true));
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(fetchRows, []);

  useEffect(() => {
    // Capture phase + stopPropagation so Esc closes ONLY the picker — the floating
    // sheet window underneath also listens for Escape on window and must not close.
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        // A confirmAction dialog on top owns Escape — let it cancel itself first.
        if (isConfirmActionOpen()) return;
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [onClose]);

  // Column sort: -1 = the built-in Name column, else an index into `columns`. `sortKey === null`
  // is the default (search-relevance-ranked, or name-alphabetical with no query) order — which
  // already reads identically to "Name ascending", so it's treated as such for the header
  // indicator and for toggling (see sortIndicator/toggleSort below). An explicit sort on ANY
  // column — including clicking Name — intentionally overrides search relevance with a plain
  // column comparison; only the untouched default preserves relevance ranking.
  const [sortKey, setSortKey] = useState<number | null>(null);
  const [sortDir, setSortDir] = useState<1 | -1>(1);

  const toggleSort = (key: number) => {
    // What's effectively showing right now, treating the untouched default as "Name ascending".
    const effectiveKey = sortKey ?? -1;
    const effectiveDir = sortKey === null ? 1 : sortDir;
    if (effectiveKey !== key) {
      setSortKey(key);
      setSortDir(1);
    } else if (effectiveDir === 1) {
      setSortKey(key);
      setSortDir(-1);
    } else {
      setSortKey(null);
      setSortDir(1);
    }
  };

  /** Active column shows its direction; every other (including Name, at rest) shows both. */
  const sortIndicator = (key: number) => {
    const active = sortKey === null ? key === -1 : sortKey === key;
    if (!active) {
      return (
        <span className="cmp-sort-arrow cmp-sort-arrow--neutral">
          <span>▲</span>
          <span>▼</span>
        </span>
      );
    }
    const dir = sortKey === null ? 1 : sortDir;
    return <span className="cmp-sort-arrow cmp-sort-arrow--active">{dir === 1 ? "▲" : "▼"}</span>;
  };

  const columnSortValue = (col: PickerColumn<T> | null, row: T): string | number => {
    if (!col) return row.name.toLowerCase();
    const raw = col.sortValue ? col.sortValue(row) : col.render(row);
    return typeof raw === "number" ? raw : String(raw).toLowerCase();
  };

  const visible = useMemo(() => {
    const base = filterFn ? (rows ?? []).filter(filterFn) : (rows ?? []);
    const searched = searchCompendium(base, query, getSearchText);
    if (sortKey === null) return searched;
    const col = sortKey === -1 ? null : columns[sortKey];
    // Copy before sorting — `searched` aliases `rows` itself when there's no query, and
    // Array.sort mutates in place.
    return [...searched].sort((a, b) => {
      const va = columnSortValue(col, a);
      const vb = columnSortValue(col, b);
      const cmp = typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb));
      return cmp * sortDir;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, query, filterFn, getSearchText, sortKey, sortDir, columns]);

  const selected = visible.find((r) => r.id === selectedId) ?? null;

  const select = (row: T | null) => {
    setSelectedId(row?.id ?? null);
    onSelect?.(row);
  };

  // Keep the selection on a visible row as search/filters change, and notify the
  // host once about a pre-selected (initialSelectedId) row after data loads.
  useEffect(() => {
    if (!visible.length) return;
    const current = selectedId ? visible.find((r) => r.id === selectedId) : null;
    if (!current) {
      select(visible[0]);
    } else if (!notifiedInitial.current) {
      notifiedInitial.current = true;
      select(current);
      listRef.current?.querySelector(`[data-row-id="${current.id}"]`)?.scrollIntoView({ block: "nearest" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const pick = async (row: T) => {
    // onPick may veto the close (return false) — e.g. the user cancels a confirm.
    const result = await onPick(row);
    if (!multiPick) {
      if (result !== false) onClose();
      return;
    }
    setAddedIds((prev) => new Set(prev).add(row.id));
  };

  const moveSelection = (delta: number) => {
    if (!visible.length) return;
    const idx = Math.max(0, visible.findIndex((r) => r.id === selectedId));
    const next = visible[Math.min(visible.length - 1, Math.max(0, idx + delta))];
    select(next);
    listRef.current
      ?.querySelector(`[data-row-id="${next.id}"]`)
      ?.scrollIntoView({ block: "nearest" });
  };

  return createPortal(
    <div className="modal-backdrop cmp-picker-backdrop" onClick={onClose}>
      <div
        ref={rootRef}
        className="modal cmp-picker"
        style={geom ? { position: "fixed", left: geom.x, top: geom.y, width: geom.w, height: geom.h } : undefined}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="cmp-head"
          onPointerDown={startDrag}
          onPointerMove={onDragMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          <h2>{title}</h2>
          <button className="btn-ghost icon-btn" title="Close" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="cmp-toolbar">
          <div className="rt-search">
            <span className="rt-search-icon">
              <Search size={12} strokeWidth={2.2} />
            </span>
            <input
              autoFocus
              value={query}
              placeholder="Search"
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") (e.preventDefault(), moveSelection(1));
                else if (e.key === "ArrowUp") (e.preventDefault(), moveSelection(-1));
                else if (e.key === "Enter" && selected) (e.preventDefault(), pick(selected));
              }}
            />
            {query ? (
              <button type="button" className="btn-ghost icon-btn" onClick={() => setQuery("")}>
                ✕
              </button>
            ) : null}
          </div>
          {filters}
        </div>

        {error ? (
          <p className="muted">
            Couldn't load the compendium.{" "}
            <button className="btn-ghost" onClick={fetchRows}>
              Retry
            </button>
          </p>
        ) : rows === null ? (
          <p className="muted">Loading…</p>
        ) : (
          <div className="cmp-body">
            <div className="cmp-list" ref={listRef}>
              <div className="cmp-row cmp-row--head">
                <span
                  className="cmp-cell cmp-cell--name cmp-cell--sortable"
                  role="button"
                  tabIndex={0}
                  onClick={() => toggleSort(-1)}
                >
                  Name
                  {sortIndicator(-1)}
                </span>
                {columns.map((col, i) => (
                  <span
                    key={col.label}
                    className="cmp-cell cmp-cell--sortable"
                    role="button"
                    tabIndex={0}
                    onClick={() => toggleSort(i)}
                  >
                    {col.label}
                    {sortIndicator(i)}
                  </span>
                ))}
              </div>
              {visible.length === 0 ? <div className="muted cmp-empty">No matches.</div> : null}
              {visible.map((row) => (
                <div
                  key={row.id}
                  data-row-id={row.id}
                  role="button"
                  tabIndex={0}
                  className={`cmp-row${row.id === selectedId ? " cmp-row--sel" : ""}`}
                  onClick={() => select(row)}
                  onDoubleClick={() => pick(row)}
                >
                  <span className="cmp-cell cmp-cell--name">
                    {row.name}
                    {badge?.(row) ? <span className="cmp-badge">{badge(row)}</span> : null}
                    {addedIds.has(row.id) ? <span className="cmp-added">✓</span> : null}
                  </span>
                  {columns.map((col) => (
                    <span key={col.label} className="cmp-cell">
                      {col.render(row)}
                    </span>
                  ))}
                </div>
              ))}
            </div>
            <div className="cmp-preview">
              {selected ? renderPreview(selected) : <p className="muted">Select an entry to preview it.</p>}
            </div>
          </div>
        )}

        {footer}
        <div className="cmp-actions">
          <span className="cmp-attribution muted">{COMPENDIUM_ATTRIBUTION}</span>
          <button className="btn-primary" disabled={!selected} onClick={() => selected && pick(selected)}>
            {pickLabel}
          </button>
        </div>

        {RESIZE_DIRS.map((dir) => (
          <div
            key={dir}
            className={`win-rs win-rs--${dir}`}
            onPointerDown={startResize(dir)}
            onPointerMove={onResizeMove}
            onPointerUp={endResize}
            onPointerCancel={endResize}
          />
        ))}
      </div>
    </div>,
    document.body,
  );
}
