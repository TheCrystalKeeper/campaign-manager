import { useState } from "react";
import { loadSpecies, type CompendiumSpecies } from "../../lib/compendium";
import { speciesAutofillPatch } from "../../lib/compendiumMap";
import { CompendiumPickerModal } from "../CompendiumPickerModal";
import type { SheetEdit } from "./context";

/// <summary>
/// Compendium species picker (2024's term for race), opened from the species chip.
/// Default = name only; "Autofill basics" also sets size/speed and appends the
/// species' traits as Species Features rows (skipping ones already present).
/// </summary>
export function SpeciesPickerModal({ sheet, onClose }: { sheet: SheetEdit; onClose: () => void }) {
  const [current, setCurrent] = useState<CompendiumSpecies | null>(null);
  const [subspeciesId, setSubspeciesId] = useState("");
  const [autofill, setAutofill] = useState(false);

  const handleSelect = (sp: CompendiumSpecies | null) => {
    setCurrent(sp);
    setSubspeciesId("");
  };

  return (
    <CompendiumPickerModal<CompendiumSpecies>
      title="Choose a species"
      load={loadSpecies}
      columns={[
        { label: "Size", render: (s) => s.size },
        { label: "Speed", render: (s) => `${s.speed} ft.` },
        { label: "Traits", render: (s) => String(s.traits.length) },
      ]}
      renderPreview={(s) => (
        <div>
          <h3>{s.name}</h3>
          <p className="cmp-tagline">
            {s.creatureType} · {s.size} · {s.speed} ft. speed
          </p>
          {s.traits.map((t) => (
            <p key={t.name}>
              <strong>{t.name}.</strong> {t.description}
            </p>
          ))}
        </div>
      )}
      onSelect={handleSelect}
      footer={
        <div className="cmp-footer">
          {current?.subspecies?.length ? (
            <label>
              Lineage
              <select value={subspeciesId} onChange={(e) => setSubspeciesId(e.target.value)}>
                <option value="">—</option>
                {current.subspecies.map((ss) => (
                  <option key={ss.id} value={ss.id}>
                    {ss.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label title="Also set size and speed, and add the species' traits as feature rows">
            <input type="checkbox" checked={autofill} onChange={(e) => setAutofill(e.target.checked)} />
            Autofill basics
          </label>
        </div>
      }
      pickLabel="Set species"
      onPick={(sp) => {
        sheet.update(
          speciesAutofillPatch(sp, {
            subspeciesId: subspeciesId || undefined,
            autofill,
            sheet: sheet.value,
          }),
        );
      }}
      onClose={onClose}
    />
  );
}
