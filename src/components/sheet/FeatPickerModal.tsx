import { useState } from "react";
import { loadFeats, type CompendiumFeat } from "../../lib/compendium";
import { featureRowFromFeat } from "../../lib/compendiumMap";
import { SHEET_ROW_CAPS } from "../../lib/types";
import { useHomebrew } from "../../hooks/useHomebrew";
import { CompendiumPickerModal } from "../CompendiumPickerModal";
import { PickerSelect } from "../pickerFilters";
import { CompendiumDescription } from "../compendiumPreview";
import { matchesSource } from "./ClassPickerModal";
import type { SheetEdit } from "./context";

const SOURCE_OPTIONS = [
  { value: "official", label: "Official" },
  { value: "homebrew", label: "Homebrew" },
];

const CATEGORY_LABEL: Record<string, string> = {
  origin: "Origin",
  general: "General",
  "fighting-style": "Fighting Style",
  "epic-boon": "Epic Boon",
  maneuver: "Maneuver",
  metamagic: "Metamagic",
  invocation: "Invocation",
};

/// <summary>
/// Feat picker (feats plus Battle Master maneuvers, Metamagic, and Eldritch
/// Invocations) — multi-pick; each Add appends a Feats row to the sheet's
/// features list (players use it on their own sheet, the DM anywhere).
/// </summary>
export function FeatPickerModal({ sheet, onClose }: { sheet: SheetEdit; onClose: () => void }) {
  const [sourceFilter, setSourceFilter] = useState("");
  const { homebrew } = useHomebrew();
  const hbFeats = Object.values(homebrew.feats);

  return (
    <CompendiumPickerModal<CompendiumFeat>
      title="Add a feat"
      load={async () => [...(await loadFeats()), ...hbFeats]}
      badge={(f) => (f.homebrew ? "Homebrew" : null)}
      filters={
        hbFeats.length ? (
          <PickerSelect
            label="Filter by source"
            value={sourceFilter}
            onChange={setSourceFilter}
            allLabel="All sources"
            options={SOURCE_OPTIONS}
          />
        ) : undefined
      }
      filterFn={(f) => matchesSource(sourceFilter, f)}
      columns={[{ label: "Category", render: (f) => CATEGORY_LABEL[f.category] ?? f.category }]}
      getSearchText={(f) => f.category}
      renderPreview={(f) => (
        <div>
          <h3>{f.name}</h3>
          <p className="cmp-tagline">{CATEGORY_LABEL[f.category] ?? f.category} feat</p>
          <CompendiumDescription text={f.description} />
        </div>
      )}
      multiPick
      onPick={(feat) => {
        // Reads latest sheet value per pick so multi-adds stack instead of clobbering.
        sheet.update({
          features: [...sheet.value.features, featureRowFromFeat(feat)].slice(0, SHEET_ROW_CAPS.features),
        });
      }}
      onClose={onClose}
    />
  );
}
