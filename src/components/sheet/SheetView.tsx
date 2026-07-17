import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { CharacterSheet, CheckSpec, SheetRecord, SheetSectionId } from "../../lib/types";
import { useSheetEdit } from "./useSheetEdit";
import { parseSheetImport, sheetExportPayload, downloadJson, transferFilename } from "../../lib/sheetTransfer";
import { SheetSidebar } from "./SheetSidebar";
import { SheetHeader, type RevealControl, type SheetTransferControl } from "./SheetHeader";
import { SheetRail, SHEET_PAGES, type SheetPageId } from "./SheetRail";
import { MainPage } from "./pages/MainPage";
import { InventoryPage } from "./pages/InventoryPage";
import { FeaturesPage } from "./pages/FeaturesPage";
import { SpellsPage } from "./pages/SpellsPage";
import { EffectsPage } from "./pages/EffectsPage";
import { BiographyPage } from "./pages/BiographyPage";
import { TraitsPage } from "./pages/TraitsPage";
import type { Adv, SheetActions, SheetEdit } from "./context";

/** Which sheet sections each rail page reveals (drives the DM's per-page reveal eye). */
const PAGE_SECTIONS: Record<SheetPageId, SheetSectionId[]> = {
  main: ["abilities", "saves", "skills"],
  inventory: ["inventory"],
  features: ["features"],
  spells: ["spells"],
  effects: ["effects"],
  biography: ["biography", "notes"],
  traits: ["traits"],
};

/** The sidebar (portrait/AC/HP…) reveals these sections. */
const SIDEBAR_SECTIONS: SheetSectionId[] = ["identity", "combat"];

export type SheetViewProps = {
  record: SheetRecord | null;
  canEdit: boolean;
  isDm: boolean;
  roomId: string;
  onChange: (sheet: Partial<CharacterSheet>) => void;
  onToggleReveal?: (section: SheetSectionId, revealed: boolean) => void;
  onRollCheck?: (check: CheckSpec, adv?: Adv) => void;
  /** Rest with real effects (Tier 3); short rests may spend hit dice. */
  onRest?: (kind: "short" | "long", spendHitDice?: number) => void;
  conditions?: SheetEdit["conditions"];
  /** Tier-3 resource actions (cast/use/death-save). */
  actions?: SheetActions;
};

/**
 * The tabbed character sheet (Phase 7): a persistent left vitals sidebar + top header,
 * and a right rail that swaps the main area between pages. One code path serves PC and
 * NPC (NPCs omit the Main tab and start on Features). Responsive via container queries
 * on `.sheet7` (see index.css) — the sidebar collapses in narrow windows.
 */
export function SheetView({
  record,
  canEdit,
  isDm,
  roomId,
  onChange,
  onToggleReveal,
  onRollCheck,
  onRest,
  conditions,
  actions,
}: SheetViewProps) {
  const { sheet, uploading, handlePortrait, overSoftCap } = useSheetEdit(record, {
    canEdit,
    isDm,
    roomId,
    onChange,
    onRollCheck,
    conditions,
    actions,
  });

  const kind = record?.kind ?? "pc";
  const pages = useMemo(() => SHEET_PAGES.filter((p) => (kind === "npc" ? p.id !== "main" : true)), [kind]);
  const [active, setActive] = useState<SheetPageId>(kind === "npc" ? "features" : "main");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  // When this sheet is a floating window, the page rail is portaled OUT of the sheet to hang
  // off the window's right edge over the tabletop (FoundryVTT-style). In a prep-page column
  // (no `.window` ancestor) it renders inline instead.
  const [railHost, setRailHost] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    const win = rootRef.current?.closest(".window");
    if (!win) {
      return;
    }
    const host = document.createElement("div");
    host.className = "window-siderail";
    win.appendChild(host);
    setRailHost(host);
    return () => {
      host.remove();
      setRailHost(null);
    };
  }, []);

  // Keep the active page valid if the kind changes (PC↔NPC) under us.
  const activePage = pages.some((p) => p.id === active) ? active : pages[0]?.id ?? "features";

  if (!record || !sheet) {
    return (
      <div className="panel-body">
        <span className="muted">This sheet no longer exists.</span>
      </div>
    );
  }

  const { value, update, hiddenFor } = sheet;

  const revealControlFor = (sections: SheetSectionId[]): RevealControl => {
    if (!isDm || record.kind !== "npc" || !onToggleReveal) return null;
    const revealed = sections.every((s) => record.revealed[s]);
    return { revealed, onToggle: (next) => sections.forEach((s) => onToggleReveal(s, next)) };
  };

  // Export/import (owner or DM). Export snapshots the live draft; import runs the file
  // through the shared sanitizer, then applies it via `update` so the local draft AND the
  // server (debounced UPDATE_SHEET, permission-checked there too) replace every field.
  const transfer: SheetTransferControl = canEdit
    ? {
        onExport: () => downloadJson(transferFilename(value.characterName, "sheet"), sheetExportPayload(value)),
        onImportFile: (file) => {
          void file.text().then((text) => {
            try {
              const imported = parseSheetImport(text);
              const target = value.characterName || "this sheet";
              const source = imported.characterName ? `"${imported.characterName}"` : "the imported sheet";
              if (!window.confirm(`Replace ${target} with ${source}? Every field on this sheet is overwritten.`)) {
                return;
              }
              update(imported);
            } catch (error) {
              window.alert(error instanceof Error ? error.message : "Could not read that file.");
            }
          });
        },
      }
    : null;

  const pageHidden = (page: SheetPageId) => PAGE_SECTIONS[page].some((s) => hiddenFor(s));

  const renderPage = () => {
    if (pageHidden(activePage)) {
      return <div className="sheet-page sheet-page--hidden muted">??? — not yet revealed</div>;
    }
    switch (activePage) {
      case "main":
        return <MainPage sheet={sheet} />;
      case "inventory":
        return <InventoryPage sheet={sheet} />;
      case "features":
        return <FeaturesPage sheet={sheet} />;
      case "spells":
        return <SpellsPage sheet={sheet} />;
      case "effects":
        return <EffectsPage sheet={sheet} />;
      case "biography":
        return <BiographyPage sheet={sheet} />;
      case "traits":
        return <TraitsPage sheet={sheet} />;
    }
  };

  const rail = <SheetRail pages={pages} active={activePage} onSelect={setActive} />;

  return (
    <div
      ref={rootRef}
      className={`sheet7 ${sidebarCollapsed ? "sheet7--sidebar-collapsed" : ""}`}
      data-inv-drop={canEdit ? record.id : undefined}
    >
      {/* Sidebar + content. In a window the page rail is portaled outside (see railHost);
          in a page column it renders inline at the right. */}
      <div className="sheet7-panel">
        <div className="sheet7-sidebar">
          <SheetSidebar
            sheet={sheet}
            roomId={roomId}
            uploading={uploading}
            handlePortrait={handlePortrait}
            onRemoveFavorite={(id) => update({ favorites: value.favorites.filter((f) => f !== id) })}
            reveal={revealControlFor(SIDEBAR_SECTIONS)}
          />
        </div>

        <button
          type="button"
          className="sheet7-collapse"
          title={sidebarCollapsed ? "Show vitals" : "Hide vitals"}
          onClick={() => setSidebarCollapsed((v) => !v)}
        >
          {sidebarCollapsed ? "›" : "‹"}
        </button>

        <div className="sheet7-main">
          <SheetHeader sheet={sheet} onRest={onRest} reveal={revealControlFor(PAGE_SECTIONS[activePage])} transfer={transfer} />
          {overSoftCap ? (
            <div className="sheet-size-warn">This sheet is getting large — trim long descriptions to avoid hitting the save limit.</div>
          ) : null}
          <div className="sheet7-page-scroll">{renderPage()}</div>
        </div>
      </div>

      {railHost ? createPortal(rail, railHost) : rail}
    </div>
  );
}
