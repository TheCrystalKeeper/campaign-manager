import { useState } from "react";
import { loadBackgrounds, type CompendiumBackground } from "../../lib/compendium";
import { backgroundAutofillPatch } from "../../lib/compendiumMap";
import { CompendiumPickerModal } from "../CompendiumPickerModal";
import type { SheetEdit } from "./context";

const skillLabel = (id: string) =>
  id
    .replace(/^skill-/, "")
    .split("-")
    .map((w) => (w === "of" ? w : w[0].toUpperCase() + w.slice(1)))
    .join(" ");

/// <summary>
/// Background picker, opened from the background chip. Default = name only;
/// "Autofill skills" also grants the background's two skill proficiencies.
/// </summary>
export function BackgroundPickerModal({ sheet, onClose }: { sheet: SheetEdit; onClose: () => void }) {
  const [autofill, setAutofill] = useState(false);

  return (
    <CompendiumPickerModal<CompendiumBackground>
      title="Choose a background"
      load={loadBackgrounds}
      columns={[{ label: "Skills", render: (b) => b.skills.map(skillLabel).join(", ") }]}
      getSearchText={(b) => b.skills.map(skillLabel).join(" ")}
      renderPreview={(b) => (
        <div>
          <h3>{b.name}</h3>
          <p className="cmp-tagline">Skill proficiencies: {b.skills.map(skillLabel).join(", ")}</p>
          {b.description.split("\n\n").map((p, i) => (
            <p key={i}>{p}</p>
          ))}
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
        sheet.update(backgroundAutofillPatch(bg, { autofill, sheet: sheet.value }));
      }}
      onClose={onClose}
    />
  );
}
