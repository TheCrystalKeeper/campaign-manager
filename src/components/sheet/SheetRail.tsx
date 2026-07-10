import type { ReactNode } from "react";
import { Backpack, BookOpen, LayoutDashboard, List, PenLine, Star, Zap } from "lucide-react";
export type SheetPageId =
  | "main"
  | "inventory"
  | "features"
  | "spells"
  | "effects"
  | "biography"
  | "traits";

export type SheetPageDef = { id: SheetPageId; label: string; icon: ReactNode };

/** The right-rail page order. NPCs omit "main" (Features is their home page). */
export const SHEET_PAGES: SheetPageDef[] = [
  { id: "main", label: "Main", icon: <LayoutDashboard size={16} strokeWidth={2.2} /> },
  { id: "inventory", label: "Inventory", icon: <Backpack size={16} strokeWidth={2.2} /> },
  { id: "features", label: "Features", icon: <List size={16} strokeWidth={2.2} /> },
  { id: "spells", label: "Spells", icon: <BookOpen size={16} strokeWidth={2.2} /> },
  { id: "effects", label: "Effects", icon: <Zap size={16} strokeWidth={2.2} /> },
  { id: "biography", label: "Biography", icon: <PenLine size={16} strokeWidth={2.2} /> },
  { id: "traits", label: "Special traits", icon: <Star size={16} strokeWidth={2.2} /> },
];

/** The right vertical page-switcher rail (same "action rail" idiom as the dock). */
export function SheetRail({
  pages,
  active,
  onSelect,
}: {
  pages: SheetPageDef[];
  active: SheetPageId;
  onSelect: (id: SheetPageId) => void;
}) {
  return (
    <div className="sheet7-rail">
      {pages.map((page) => (
        <button
          type="button"
          key={page.id}
          className={`sheet-rail-btn ${active === page.id ? "sheet-rail-btn--active" : ""}`}
          title={page.label}
          onClick={() => onSelect(page.id)}
        >
          {page.icon}
        </button>
      ))}
    </div>
  );
}
