import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Search } from "lucide-react";
import { COMPENDIUM_ATTRIBUTION, searchCompendium } from "../lib/compendium";

/// <summary>
/// Shared "browse the compendium" picker: search box (+ optional filter controls),
/// a two-pane body (result list left, full-text preview right), an optional footer
/// for per-category controls (autofill checkboxes etc.), and the attribution
/// line. Same portal/backdrop/Esc pattern as AssetPickerModal.
/// `multiPick` keeps the modal open after Add so several entries can be grabbed
/// in one visit (added rows get a ✓).
/// </summary>

export type PickerColumn<T> = { label: string; render: (row: T) => ReactNode };

export function CompendiumPickerModal<T extends { id: string; name: string }>({
  title,
  load,
  getSearchText,
  columns,
  renderPreview,
  filters,
  filterFn,
  footer,
  pickLabel = "Add",
  multiPick = false,
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
  pickLabel?: string;
  multiPick?: boolean;
  onPick: (row: T) => void;
  onClose: () => void;
  /** Notifies the host when the highlighted row changes (drives footer state). */
  onSelect?: (row: T | null) => void;
}) {
  const [rows, setRows] = useState<T[] | null>(null);
  const [error, setError] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [addedIds, setAddedIds] = useState<Set<string>>(new Set());
  const listRef = useRef<HTMLDivElement>(null);

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
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [onClose]);

  const visible = useMemo(() => {
    const base = filterFn ? (rows ?? []).filter(filterFn) : (rows ?? []);
    return searchCompendium(base, query, getSearchText);
  }, [rows, query, filterFn, getSearchText]);

  const selected = visible.find((r) => r.id === selectedId) ?? null;

  const select = (row: T | null) => {
    setSelectedId(row?.id ?? null);
    onSelect?.(row);
  };

  // Keep the selection on a visible row as search/filters change.
  useEffect(() => {
    if (selectedId && !visible.some((r) => r.id === selectedId)) select(visible[0] ?? null);
    else if (!selectedId && visible.length) select(visible[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const pick = (row: T) => {
    onPick(row);
    if (!multiPick) {
      onClose();
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
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal cmp-picker" onClick={(e) => e.stopPropagation()}>
        <div className="cmp-head">
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
                <span className="cmp-cell cmp-cell--name">Name</span>
                {columns.map((col) => (
                  <span key={col.label} className="cmp-cell">
                    {col.label}
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
      </div>
    </div>,
    document.body,
  );
}
