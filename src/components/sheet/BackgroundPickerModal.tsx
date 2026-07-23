import { useEffect, useState } from "react";
import { loadBackgrounds, type CompendiumBackground } from "../../lib/compendium";
import { backgroundAutofillPatch } from "../../lib/compendiumMap";
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

const skillLabel = (id: string) =>
  id
    .replace(/^skill-/, "")
    .split("-")
    .map((w) => (w === "of" ? w : w[0].toUpperCase() + w.slice(1)))
    .join(" ");

/// <summary>
/// Background picker, opened from the background chip. Reopening pre-selects the
/// current background and "Autofill skills" state. Default = name only; "Autofill
/// skills" also grants the background's two skill proficiencies.
/// </summary>
export function BackgroundPickerModal({ sheet, onClose }: { sheet: SheetEdit; onClose: () => void }) {
  const [backgrounds, setBackgrounds] = useState<CompendiumBackground[] | null>(null);
  const [autofill, setAutofill] = useState(sheet.value.backgroundAutofill);
  const [sourceFilter, setSourceFilter] = useState("");
  const { homebrew } = useHomebrew();
  const hbBackgrounds = Object.values(homebrew.backgrounds);

  useEffect(() => {
    void loadBackgrounds().then(
      (rows) => setBackgrounds([...rows, ...hbBackgrounds]),
      () => setBackgrounds(hbBackgrounds),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Wait for the list so the pre-selection is stable at mount (loadBackgrounds is cached).
  if (backgrounds === null) return null;
  const initialId = backgrounds.find(
    (b) => b.name.toLowerCase() === sheet.value.background.trim().toLowerCase(),
  )?.id;

  return (
    <CompendiumPickerModal<CompendiumBackground>
      title="Choose a background"
      load={async () => [...(await loadBackgrounds()), ...hbBackgrounds]}
      initialSelectedId={initialId}
      badge={(b) => (b.homebrew ? "Homebrew" : null)}
      filters={
        hbBackgrounds.length ? (
          <PickerSelect
            label="Filter by source"
            value={sourceFilter}
            onChange={setSourceFilter}
            allLabel="All sources"
            options={SOURCE_OPTIONS}
          />
        ) : undefined
      }
      filterFn={(b) => matchesSource(sourceFilter, b)}
      columns={[{ label: "Skills", render: (b) => b.skills.map(skillLabel).join(", ") }]}
      getSearchText={(b) => b.skills.map(skillLabel).join(" ")}
      renderPreview={(b) => (
        <div>
          <h3>{b.name}</h3>
          <p className="cmp-tagline">Skill proficiencies: {b.skills.map(skillLabel).join(", ")}</p>
          <CompendiumDescription text={b.description} />
        </div>
      )}
      footer={
        <div className="cmp-footer">
          <label title="Also grant the background's skill proficiencies">
            <input type="checkbox" checked={autofill} onChange={(e) => setAutofill(e.target.checked)} />
            Autofill skills
          </label>
        </div>
      }
      pickLabel="Set background"
      onPick={(bg) => {
        sheet.update({ ...backgroundAutofillPatch(bg, { autofill, sheet: sheet.value }), backgroundAutofill: autofill });
      }}
      onClose={onClose}
    />
  );
}
