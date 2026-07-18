import { Field } from "../atoms";
import type { SheetEdit } from "../context";
import { useTextareaSize } from "../useTextareaSize";

/** A labeled multiline text block. Its resized height is remembered per sheet+field. */
function TextBlock({
  label,
  value,
  disabled,
  roomId,
  sheetId,
  field,
  rows = 3,
  className,
  onChange,
}: {
  label: string;
  value: string;
  disabled?: boolean;
  roomId: string;
  sheetId: string;
  field: string;
  rows?: number;
  className?: string;
  onChange: (value: string) => void;
}) {
  const ref = useTextareaSize(roomId, sheetId, field);
  return (
    <div className="bio-block">
      <label>{label}</label>
      <textarea
        ref={ref}
        className={className}
        value={value}
        disabled={disabled}
        rows={rows}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

/**
 * The Biography page: a details grid (alignment/faith/gender/eyes/hair/skin/height/
 * weight/age), ideals/bonds/flaws + personality/appearance, and the full biography text.
 */
export function BiographyPage({ sheet }: { sheet: SheetEdit }) {
  const { value, id, roomId, canEdit, update } = sheet;
  return (
    <div className="sheet-page bio-page">
      <div className="bio-details sheet-section">
        <Field label="Alignment" value={value.alignment} disabled={!canEdit} onChange={(alignment) => update({ alignment })} />
        <Field label="Faith" value={value.faith} disabled={!canEdit} onChange={(faith) => update({ faith })} />
        <Field label="Gender" value={value.gender} disabled={!canEdit} onChange={(gender) => update({ gender })} />
        <Field label="Eyes" value={value.eyes} disabled={!canEdit} onChange={(eyes) => update({ eyes })} />
        <Field label="Hair" value={value.hair} disabled={!canEdit} onChange={(hair) => update({ hair })} />
        <Field label="Skin" value={value.skin} disabled={!canEdit} onChange={(skin) => update({ skin })} />
        <Field label="Height" value={value.height} disabled={!canEdit} onChange={(height) => update({ height })} />
        <Field label="Weight" value={value.weight} disabled={!canEdit} onChange={(weight) => update({ weight })} />
        <Field label="Age" value={value.age} disabled={!canEdit} onChange={(age) => update({ age })} />
      </div>

      <div className="bio-columns">
        <div className="bio-col sheet-section">
          <TextBlock label="Ideals" value={value.ideals} disabled={!canEdit} roomId={roomId} sheetId={id} field="ideals" onChange={(ideals) => update({ ideals })} />
          <TextBlock label="Bonds" value={value.bonds} disabled={!canEdit} roomId={roomId} sheetId={id} field="bonds" onChange={(bonds) => update({ bonds })} />
          <TextBlock label="Flaws" value={value.flaws} disabled={!canEdit} roomId={roomId} sheetId={id} field="flaws" onChange={(flaws) => update({ flaws })} />
        </div>
        <div className="bio-col sheet-section">
          <TextBlock label="Personality Traits" value={value.personality} disabled={!canEdit} roomId={roomId} sheetId={id} field="personality" onChange={(personality) => update({ personality })} />
          <TextBlock label="Appearance" value={value.appearance} disabled={!canEdit} roomId={roomId} sheetId={id} field="appearance" onChange={(appearance) => update({ appearance })} />
        </div>
      </div>

      <div className="sheet-section">
        <TextBlock
          label="Biography"
          value={value.backstoryPersonality}
          disabled={!canEdit}
          roomId={roomId}
          sheetId={id}
          field="backstoryPersonality"
          rows={8}
          className="bio-full"
          onChange={(backstoryPersonality) => update({ backstoryPersonality })}
        />
      </div>
    </div>
  );
}
