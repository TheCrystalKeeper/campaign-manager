import { useEffect, useState } from "react";
import { loadSpecies, type CompendiumSpecies } from "../../lib/compendium";
import { speciesAutofillPatch } from "../../lib/compendiumMap";
import { useHomebrew } from "../../hooks/useHomebrew";
import { confirmAction } from "../ConfirmActionDialog";
import { CompendiumPickerModal } from "../CompendiumPickerModal";
import { PickerSelect } from "../pickerFilters";
import { matchesSource } from "./ClassPickerModal";
import type { SheetEdit } from "./context";

const SOURCE_OPTIONS = [
  { value: "official", label: "Official" },
  { value: "homebrew", label: "Homebrew" },
];

/** Reverse-map a `race` display string ("Elf (Drow)") to species + subspecies ids. */
function matchSpecies(
  species: CompendiumSpecies[],
  race: string,
): { speciesId?: string; subspeciesId?: string } {
  const trimmed = race.trim();
  if (!trimmed) return {};
  const paren = /^(.*?)\s*\(([^)]+)\)\s*$/.exec(trimmed);
  const baseName = (paren ? paren[1] : trimmed).trim().toLowerCase();
  const subName = paren ? paren[2].trim().toLowerCase() : "";
  const sp = species.find((s) => s.name.toLowerCase() === baseName);
  if (!sp) return {};
  const sub = subName
    ? sp.subspecies?.find((ss) => ss.name.replace(/^.*?:\s*/, "").trim().toLowerCase() === subName)
    : undefined;
  return { speciesId: sp.id, subspeciesId: sub?.id };
}

/// <summary>
/// Compendium species picker (2024's term for race), opened from the species chip.
/// Reopening pre-selects the current species, lineage, and "Autofill basics" state.
/// Default = name only; "Autofill basics" also sets size/speed and REPLACES the
/// species' feature rows — swapping species deletes the old set (confirmed first
/// when any species features already exist).
/// </summary>
export function SpeciesPickerModal({ sheet, onClose }: { sheet: SheetEdit; onClose: () => void }) {
  const [species, setSpecies] = useState<CompendiumSpecies[] | null>(null);
  const [current, setCurrent] = useState<CompendiumSpecies | null>(null);
  const [subspeciesId, setSubspeciesId] = useState("");
  const [autofill, setAutofill] = useState(sheet.value.speciesAutofill);
  const [sourceFilter, setSourceFilter] = useState("");
  const { homebrew } = useHomebrew();
  const hbSpecies = Object.values(homebrew.species);

  useEffect(() => {
    void loadSpecies().then(
      (rows) => setSpecies([...rows, ...hbSpecies]),
      () => setSpecies(hbSpecies),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Wait for the species list so the pre-selection is stable at mount (loadSpecies
  // is cached, so this only actually blocks the very first compendium open).
  if (species === null) return null;
  const initial = matchSpecies(species, sheet.value.race);

  // Only clear the lineage when the highlighted species genuinely changes, so the
  // pre-seeded lineage survives the modal's initial auto-select.
  const handleSelect = (sp: CompendiumSpecies | null) => {
    if (sp?.id === current?.id) return;
    setCurrent(sp);
    setSubspeciesId(sp?.id === initial.speciesId ? initial.subspeciesId ?? "" : "");
  };

  return (
    <CompendiumPickerModal<CompendiumSpecies>
      title="Choose a species"
      load={async () => [...(await loadSpecies()), ...hbSpecies]}
      initialSelectedId={initial.speciesId}
      badge={(s) => (s.homebrew ? "Homebrew" : null)}
      filters={
        hbSpecies.length ? (
          <PickerSelect
            label="Filter by source"
            value={sourceFilter}
            onChange={setSourceFilter}
            allLabel="All sources"
            options={SOURCE_OPTIONS}
          />
        ) : undefined
      }
      filterFn={(s) => matchesSource(sourceFilter, s)}
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
          <label title="Also set size and speed, and replace the species' feature rows">
            <input type="checkbox" checked={autofill} onChange={(e) => setAutofill(e.target.checked)} />
            Autofill basics
          </label>
          {sheet.value.race.trim() ? (
            <button
              type="button"
              className="btn-ghost"
              title="Remove this species (and its trait rows), leaving it unset"
              onClick={async () => {
                // Species features are tagged source "species"; clearing removes them the
                // same way switching species replaces them — confirm when any exist.
                const speciesRows = sheet.value.features.filter((f) => f.source === "species");
                if (speciesRows.length) {
                  const n = speciesRows.length;
                  const ok = await confirmAction({
                    title: "Clear species?",
                    body: `Removing this species also removes its ${n} species feature${n === 1 ? "" : "s"} (including any you added by hand).`,
                    confirmLabel: "Clear species",
                    danger: true,
                  });
                  if (!ok) return;
                }
                sheet.update({
                  race: "",
                  speciesAutofill: false,
                  features: sheet.value.features.filter((f) => f.source !== "species"),
                });
                onClose();
              }}
            >
              Clear species
            </button>
          ) : null}
        </div>
      }
      pickLabel="Set species"
      onPick={async (sp) => {
        const speciesRows = sheet.value.features.filter((f) => f.source === "species");
        if (autofill && speciesRows.length) {
          const n = speciesRows.length;
          const plural = n === 1 ? "" : "s";
          const them = n === 1 ? "it" : "them";
          const rows = `the ${n} current species feature${plural} (including any you added by hand)`;
          const newSub = sp.subspecies?.find((ss) => ss.id === subspeciesId)?.name;
          const sameSpecies = initial.speciesId === sp.id;
          const oldSub = sameSpecies
            ? sp.subspecies?.find((ss) => ss.id === initial.subspeciesId)?.name
            : undefined;
          const lineageChanged = sameSpecies && (initial.subspeciesId ?? "") !== (subspeciesId || "");

          // Word the warning for what's actually changing: a whole new species, a
          // lineage swap within the same species (naming both, "no lineage" when blank),
          // or a plain re-apply.
          let title = "Replace species features?";
          let confirmLabel = "Replace";
          let body: string;
          if (!sameSpecies) {
            body = `Switching to ${sp.name} will remove ${rows} and replace ${them} with ${sp.name}'s features.`;
          } else if (lineageChanged) {
            title = "Change lineage?";
            confirmLabel = "Change lineage";
            body = `Changing your ${sp.name} lineage from ${oldSub ?? "no lineage"} to ${newSub ?? "no lineage"} will remove ${rows} and replace ${them} with the new set.`;
          } else {
            body = `Re-applying ${sp.name}${newSub ? ` (${newSub})` : ""} will remove ${rows} and replace ${them}.`;
          }

          const ok = await confirmAction({ title, body, confirmLabel, danger: true });
          if (!ok) return false;
        }
        sheet.update({
          ...speciesAutofillPatch(sp, { subspeciesId: subspeciesId || undefined, autofill, sheet: sheet.value }),
          speciesAutofill: autofill,
        });
      }}
      onClose={onClose}
    />
  );
}
