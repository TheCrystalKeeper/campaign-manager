import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type {
  CompendiumBackground,
  CompendiumClass,
  CompendiumFeat,
  CompendiumSpecies,
  CompendiumSpell,
  CompendiumSubclass,
  CompendiumTrait,
} from "../../lib/compendium";
import { DEFAULT_SHEET_TEMPLATE, rowId } from "../../lib/types";

/// <summary>
/// Editor modals for the homebrew categories that have no existing editor (classes,
/// subclasses, spells, backgrounds, feats, species). Homebrew items/monsters reuse the
/// Item Sheet / NPC sheet instead. Each editor builds a full Compendium*-shaped entry
/// (ids prefixed "hb-" so they can never collide with official slugs) and hands it to
/// `onSave` → UPSERT_HOMEBREW; the server re-validates via normalizeHomebrew*.
/// </summary>

export type ClassOption = { value: string; label: string };

const ABILITIES = DEFAULT_SHEET_TEMPLATE.abilities;
const SKILLS = DEFAULT_SHEET_TEMPLATE.skills.filter((s) => s.mode === "ability");
const SPELL_SCHOOLS = [
  "Abjuration", "Conjuration", "Divination", "Enchantment",
  "Evocation", "Illusion", "Necromancy", "Transmutation",
];
const SIZES = ["Tiny", "Small", "Medium", "Large", "Huge", "Gargantuan"];
const FEAT_CATEGORY_OPTIONS = [
  { value: "general", label: "General" },
  { value: "origin", label: "Origin" },
  { value: "fighting-style", label: "Fighting style" },
  { value: "epic-boon", label: "Epic boon" },
  { value: "maneuver", label: "Maneuver" },
  { value: "metamagic", label: "Metamagic" },
  { value: "invocation", label: "Invocation" },
];

const splitList = (value: string): string[] =>
  value.split(",").map((s) => s.trim()).filter(Boolean);

function EditorModal({
  title,
  canSave,
  onSave,
  onClose,
  children,
}: {
  title: string;
  canSave: boolean;
  onSave: () => void;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    // Capture phase + stopPropagation, same as CompendiumPickerModal: Esc closes only
    // this editor, not the panel/window underneath.
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [onClose]);

  return createPortal(
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal hb-editor" onClick={(e) => e.stopPropagation()}>
        <div className="hb-editor-head">
          <h2>{title}</h2>
          <button className="btn-ghost icon-btn" title="Close" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="stack hb-editor-body">{children}</div>
        <div className="hb-editor-actions">
          <button className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" disabled={!canSave} onClick={onSave}>
            Save
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Server-side description cap (HB_DESC_CAP) mirrored on every editor textarea, so a
 *  long paste can't silently lose its tail to normalization. */
const DESC_MAX = 5000;

/** Checkbox chip grid (abilities, skills, classes). `max` mirrors a server-side list
 *  cap: at the limit, unchecked options disable instead of silently dropping on save. */
function CheckGrid({
  options,
  selected,
  onToggle,
  max,
}: {
  options: Array<{ value: string; label: string }>;
  selected: string[];
  onToggle: (value: string) => void;
  max?: number;
}) {
  const atMax = max !== undefined && selected.length >= max;
  return (
    <div className="hb-checkgrid">
      {options.map((option) => {
        const checked = selected.includes(option.value);
        return (
          <label key={option.value} className="hb-check">
            <input
              type="checkbox"
              checked={checked}
              disabled={!checked && atMax}
              onChange={() => onToggle(option.value)}
            />
            {option.label}
          </label>
        );
      })}
    </div>
  );
}

const toggle = (list: string[], value: string): string[] =>
  list.includes(value) ? list.filter((v) => v !== value) : [...list, value];

// ---------------------------------------------------------------------------
// Class
// ---------------------------------------------------------------------------

export function HomebrewClassEditor({
  initial,
  onSave,
  onClose,
}: {
  initial?: CompendiumClass;
  onSave: (entry: CompendiumClass) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [hitDie, setHitDie] = useState(initial?.hitDie ?? 8);
  const [saves, setSaves] = useState<string[]>(initial?.saves ?? []);
  const [primaryAbility, setPrimaryAbility] = useState(initial?.primaryAbility ?? "");
  const [armorProfs, setArmorProfs] = useState((initial?.armorProfs ?? []).join(", "));
  const [weaponProfs, setWeaponProfs] = useState((initial?.weaponProfs ?? []).join(", "));
  const [toolProfs, setToolProfs] = useState((initial?.toolProfs ?? []).join(", "));
  const [skillChoose, setSkillChoose] = useState(initial?.skillChoices?.choose ?? 2);
  const [skillFrom, setSkillFrom] = useState<string[]>(initial?.skillChoices?.from ?? []);
  const [spellAbility, setSpellAbility] = useState(initial?.spellcasting?.abilityId ?? "");
  const [casterType, setCasterType] = useState<"full" | "half" | "pact">(
    initial?.spellcasting?.casterType ?? "full",
  );
  const [subclassLevel, setSubclassLevel] = useState(initial?.subclassLevel ?? 3);

  const save = () =>
    onSave({
      id: initial?.id ?? rowId("hb-class"),
      name: name.trim(),
      hitDie,
      ...(primaryAbility.trim() ? { primaryAbility: primaryAbility.trim() } : {}),
      saves,
      ...(splitList(armorProfs).length ? { armorProfs: splitList(armorProfs) } : {}),
      ...(splitList(weaponProfs).length ? { weaponProfs: splitList(weaponProfs) } : {}),
      ...(splitList(toolProfs).length ? { toolProfs: splitList(toolProfs) } : {}),
      ...(skillFrom.length ? { skillChoices: { choose: skillChoose, from: skillFrom } } : {}),
      ...(spellAbility ? { spellcasting: { abilityId: spellAbility, casterType } } : {}),
      // Preserved on edit; homebrew subclasses link back via their own classId.
      subclassIds: initial?.subclassIds ?? [],
      subclassLevel,
      multiclass: initial?.multiclass ?? { prereqs: [] },
      homebrew: true,
    });

  return (
    <EditorModal
      title={initial ? "Edit homebrew class" : "New homebrew class"}
      canSave={Boolean(name.trim())}
      onSave={save}
      onClose={onClose}
    >
      <div className="field">
        <label>Name</label>
        <input autoFocus value={name} placeholder="Witcher" onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="row">
        <div className="field" style={{ flex: 1 }}>
          <label>Hit die</label>
          <select value={hitDie} onChange={(e) => setHitDie(Number(e.target.value))}>
            {[6, 8, 10, 12].map((d) => (
              <option key={d} value={d}>
                d{d}
              </option>
            ))}
          </select>
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label>Primary ability</label>
          <input
            value={primaryAbility}
            placeholder="Strength"
            onChange={(e) => setPrimaryAbility(e.target.value)}
          />
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label>Subclass level</label>
          <input
            type="number"
            min={1}
            max={20}
            value={subclassLevel}
            onChange={(e) => setSubclassLevel(Math.max(1, Math.min(20, Number(e.target.value) || 3)))}
          />
        </div>
      </div>
      <div className="field">
        <label>Saving throw proficiencies</label>
        <CheckGrid
          options={ABILITIES.map((a) => ({ value: a.id, label: a.abbr }))}
          selected={saves}
          onToggle={(v) => setSaves((s) => toggle(s, v))}
        />
      </div>
      <div className="field">
        <label>Armor proficiencies (comma-separated)</label>
        <input value={armorProfs} placeholder="Light armor, Shields" onChange={(e) => setArmorProfs(e.target.value)} />
      </div>
      <div className="field">
        <label>Weapon proficiencies (comma-separated)</label>
        <input value={weaponProfs} placeholder="Simple weapons, Martial weapons" onChange={(e) => setWeaponProfs(e.target.value)} />
      </div>
      <div className="field">
        <label>Tool proficiencies (comma-separated)</label>
        <input value={toolProfs} placeholder="Alchemist's supplies" onChange={(e) => setToolProfs(e.target.value)} />
      </div>
      <div className="field">
        <label>
          Skill proficiencies — choose{" "}
          <input
            type="number"
            min={1}
            max={10}
            className="hb-inline-num"
            value={skillChoose}
            onChange={(e) => setSkillChoose(Math.max(1, Math.min(10, Number(e.target.value) || 2)))}
          />{" "}
          from:
        </label>
        <CheckGrid
          options={SKILLS.map((s) => ({ value: s.id, label: s.name }))}
          selected={skillFrom}
          onToggle={(v) => setSkillFrom(s => toggle(s, v))}
        />
      </div>
      <div className="row">
        <div className="field" style={{ flex: 1 }}>
          <label>Spellcasting ability</label>
          <select value={spellAbility} onChange={(e) => setSpellAbility(e.target.value)}>
            <option value="">None (not a caster)</option>
            {ABILITIES.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label>Caster type</label>
          <select
            value={casterType}
            disabled={!spellAbility}
            onChange={(e) => setCasterType(e.target.value as "full" | "half" | "pact")}
          >
            <option value="full">Full caster</option>
            <option value="half">Half caster</option>
            <option value="pact">Pact (warlock-style)</option>
          </select>
        </div>
      </div>
      <p className="muted hb-hint">
        Class features aren't automated — add them as feature rows on each character's sheet.
      </p>
    </EditorModal>
  );
}

// ---------------------------------------------------------------------------
// Subclass
// ---------------------------------------------------------------------------

export function HomebrewSubclassEditor({
  initial,
  classOptions,
  onSave,
  onClose,
}: {
  initial?: CompendiumSubclass;
  /** Official + homebrew classes ("barbarian" … "hb-class-xxxx"). */
  classOptions: ClassOption[];
  onSave: (entry: CompendiumSubclass) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [classId, setClassId] = useState(initial?.classId ?? classOptions[0]?.value ?? "");
  const [summary, setSummary] = useState(initial?.summary ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");

  // The class list loads async — if the editor opened before it arrived, default the
  // (empty) selection to the first class once options exist.
  useEffect(() => {
    if (!classId && classOptions[0]) setClassId(classOptions[0].value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classOptions.length]);

  const save = () =>
    onSave({
      id: initial?.id ?? rowId("hb-subclass"),
      name: name.trim(),
      classId,
      ...(summary.trim() ? { summary: summary.trim() } : {}),
      description,
      homebrew: true,
    });

  return (
    <EditorModal
      title={initial ? "Edit homebrew subclass" : "New homebrew subclass"}
      canSave={Boolean(name.trim() && classId)}
      onSave={save}
      onClose={onClose}
    >
      <div className="field">
        <label>Name</label>
        <input autoFocus value={name} placeholder="Path of the Moon" onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="field">
        <label>Class</label>
        <select value={classId} onChange={(e) => setClassId(e.target.value)}>
          {classId === "" ? (
            <option value="" disabled>
              Select a class…
            </option>
          ) : null}
          {classOptions.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label>Summary (one line, shown in the picker)</label>
        <input value={summary} onChange={(e) => setSummary(e.target.value)} />
      </div>
      <div className="field">
        <label>Description</label>
        <textarea rows={8} maxLength={DESC_MAX} value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>
    </EditorModal>
  );
}

// ---------------------------------------------------------------------------
// Spell
// ---------------------------------------------------------------------------

export function HomebrewSpellEditor({
  initial,
  classOptions,
  onSave,
  onClose,
}: {
  initial?: CompendiumSpell;
  classOptions: ClassOption[];
  onSave: (entry: CompendiumSpell) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [level, setLevel] = useState(initial?.level ?? 0);
  const [school, setSchool] = useState(initial?.school ?? "Evocation");
  const [time, setTime] = useState(initial?.time ?? "1 action");
  const [range, setRange] = useState(initial?.range ?? "60 feet");
  const [components, setComponents] = useState(initial?.components ?? "V, S");
  const [duration, setDuration] = useState(initial?.duration ?? "Instantaneous");
  const [concentration, setConcentration] = useState(Boolean(initial?.concentration));
  const [ritual, setRitual] = useState(Boolean(initial?.ritual));
  const [classes, setClasses] = useState<string[]>(initial?.classes ?? []);
  const [roll, setRoll] = useState(initial?.roll ?? "");
  const [saveAbility, setSaveAbility] = useState(initial?.saveAbility ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");

  const save = () =>
    onSave({
      id: initial?.id ?? rowId("hb-spell"),
      name: name.trim(),
      level,
      school,
      time: time.trim(),
      range: range.trim(),
      components: components.trim(),
      duration: duration.trim(),
      ...(concentration ? { concentration: true } : {}),
      ...(ritual ? { ritual: true } : {}),
      classes,
      ...(roll.trim() ? { roll: roll.trim() } : {}),
      ...(saveAbility ? { saveAbility } : {}),
      description,
      homebrew: true,
    });

  return (
    <EditorModal
      title={initial ? "Edit homebrew spell" : "New homebrew spell"}
      canSave={Boolean(name.trim())}
      onSave={save}
      onClose={onClose}
    >
      <div className="field">
        <label>Name</label>
        <input autoFocus value={name} placeholder="Chromatic Cascade" onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="row">
        <div className="field" style={{ flex: 1 }}>
          <label>Level</label>
          <select value={level} onChange={(e) => setLevel(Number(e.target.value))}>
            {Array.from({ length: 10 }, (_, lv) => (
              <option key={lv} value={lv}>
                {lv === 0 ? "Cantrip" : `Level ${lv}`}
              </option>
            ))}
          </select>
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label>School</label>
          <select value={school} onChange={(e) => setSchool(e.target.value)}>
            {SPELL_SCHOOLS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="row">
        <div className="field" style={{ flex: 1 }}>
          <label>Casting time</label>
          <input value={time} onChange={(e) => setTime(e.target.value)} />
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label>Range</label>
          <input value={range} onChange={(e) => setRange(e.target.value)} />
        </div>
      </div>
      <div className="row">
        <div className="field" style={{ flex: 1 }}>
          <label>Components</label>
          <input value={components} placeholder="V, S, M (a pinch of salt)" onChange={(e) => setComponents(e.target.value)} />
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label>Duration</label>
          <input value={duration} onChange={(e) => setDuration(e.target.value)} />
        </div>
      </div>
      <div className="row">
        <label className="hb-check">
          <input type="checkbox" checked={concentration} onChange={() => setConcentration((v) => !v)} />
          Concentration
        </label>
        <label className="hb-check">
          <input type="checkbox" checked={ritual} onChange={() => setRitual((v) => !v)} />
          Ritual
        </label>
      </div>
      <div className="row">
        <div className="field" style={{ flex: 1 }}>
          <label>Damage/heal roll (optional)</label>
          <input value={roll} placeholder="8d6" onChange={(e) => setRoll(e.target.value)} />
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label>Saving throw (optional)</label>
          <select value={saveAbility} onChange={(e) => setSaveAbility(e.target.value)}>
            <option value="">None</option>
            {ABILITIES.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="field">
        <label>Classes that can cast it</label>
        {/* max mirrors normalizeHomebrewSpell's 20-class cap. */}
        <CheckGrid
          options={classOptions}
          selected={classes}
          onToggle={(v) => setClasses((s) => toggle(s, v))}
          max={20}
        />
      </div>
      <div className="field">
        <label>Description</label>
        <textarea rows={8} maxLength={DESC_MAX} value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>
    </EditorModal>
  );
}

// ---------------------------------------------------------------------------
// Background
// ---------------------------------------------------------------------------

export function HomebrewBackgroundEditor({
  initial,
  onSave,
  onClose,
}: {
  initial?: CompendiumBackground;
  onSave: (entry: CompendiumBackground) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [skills, setSkills] = useState<string[]>(initial?.skills ?? []);
  const [description, setDescription] = useState(initial?.description ?? "");

  const save = () =>
    onSave({
      id: initial?.id ?? rowId("hb-background"),
      name: name.trim(),
      skills,
      description,
      homebrew: true,
    });

  return (
    <EditorModal
      title={initial ? "Edit homebrew background" : "New homebrew background"}
      canSave={Boolean(name.trim())}
      onSave={save}
      onClose={onClose}
    >
      <div className="field">
        <label>Name</label>
        <input autoFocus value={name} placeholder="Gravedigger" onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="field">
        <label>Skill proficiencies (backgrounds normally grant two)</label>
        <CheckGrid
          options={SKILLS.map((s) => ({ value: s.id, label: s.name }))}
          selected={skills}
          onToggle={(v) => setSkills((s) => toggle(s, v))}
        />
      </div>
      <div className="field">
        <label>Description</label>
        <textarea rows={6} maxLength={DESC_MAX} value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>
    </EditorModal>
  );
}

// ---------------------------------------------------------------------------
// Feat
// ---------------------------------------------------------------------------

export function HomebrewFeatEditor({
  initial,
  onSave,
  onClose,
}: {
  initial?: CompendiumFeat;
  onSave: (entry: CompendiumFeat) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [category, setCategory] = useState(initial?.category ?? "general");
  const [description, setDescription] = useState(initial?.description ?? "");

  const save = () =>
    onSave({
      id: initial?.id ?? rowId("hb-feat"),
      name: name.trim(),
      category,
      description,
      homebrew: true,
    });

  return (
    <EditorModal
      title={initial ? "Edit homebrew feat" : "New homebrew feat"}
      canSave={Boolean(name.trim())}
      onSave={save}
      onClose={onClose}
    >
      <div className="field">
        <label>Name</label>
        <input autoFocus value={name} placeholder="Shield Slam" onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="field">
        <label>Category</label>
        <select value={category} onChange={(e) => setCategory(e.target.value)}>
          {FEAT_CATEGORY_OPTIONS.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label>Description</label>
        <textarea rows={6} maxLength={DESC_MAX} value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>
    </EditorModal>
  );
}

// ---------------------------------------------------------------------------
// Species
// ---------------------------------------------------------------------------

export function HomebrewSpeciesEditor({
  initial,
  onSave,
  onClose,
}: {
  initial?: CompendiumSpecies;
  onSave: (entry: CompendiumSpecies) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [creatureType, setCreatureType] = useState(initial?.creatureType ?? "Humanoid");
  const [size, setSize] = useState(initial?.size ?? "Medium");
  const [speed, setSpeed] = useState(initial?.speed ?? 30);
  const [traits, setTraits] = useState<CompendiumTrait[]>(initial?.traits ?? []);

  const patchTrait = (index: number, patch: Partial<CompendiumTrait>) =>
    setTraits((rows) => rows.map((t, i) => (i === index ? { ...t, ...patch } : t)));

  const save = () =>
    onSave({
      id: initial?.id ?? rowId("hb-species"),
      name: name.trim(),
      creatureType: creatureType.trim() || "Humanoid",
      size,
      speed,
      traits: traits.filter((t) => t.name.trim()),
      // Subspecies aren't editable here; an edit keeps whatever the entry already had.
      ...(initial?.subspecies?.length ? { subspecies: initial.subspecies } : {}),
      homebrew: true,
    });

  return (
    <EditorModal
      title={initial ? "Edit homebrew species" : "New homebrew species"}
      canSave={Boolean(name.trim())}
      onSave={save}
      onClose={onClose}
    >
      <div className="field">
        <label>Name</label>
        <input autoFocus value={name} placeholder="Sylvan Automaton" onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="row">
        <div className="field" style={{ flex: 1 }}>
          <label>Creature type</label>
          <input value={creatureType} onChange={(e) => setCreatureType(e.target.value)} />
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label>Size</label>
          <select value={size} onChange={(e) => setSize(e.target.value)}>
            {SIZES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label>Speed (ft)</label>
          <input
            type="number"
            min={0}
            max={120}
            value={speed}
            onChange={(e) => setSpeed(Math.max(0, Math.min(120, Number(e.target.value) || 0)))}
          />
        </div>
      </div>
      <div className="field">
        <label>Traits (become feature rows on the sheet)</label>
        <div className="stack">
          {traits.map((trait, index) => (
            <div className="hb-trait" key={index}>
              <div className="row">
                <input
                  value={trait.name}
                  placeholder="Trait name"
                  style={{ flex: 1 }}
                  onChange={(e) => patchTrait(index, { name: e.target.value })}
                />
                <button
                  className="btn-ghost icon-btn"
                  title="Remove trait"
                  onClick={() => setTraits((rows) => rows.filter((_, i) => i !== index))}
                >
                  ✕
                </button>
              </div>
              <textarea
                rows={3}
                value={trait.description}
                placeholder="What it does"
                onChange={(e) => patchTrait(index, { description: e.target.value })}
              />
            </div>
          ))}
          {/* 20 mirrors hbTraits' server-side cap — past it, extra rows would silently drop. */}
          <button
            className="btn-ghost"
            disabled={traits.length >= 20}
            onClick={() => setTraits((rows) => [...rows, { name: "", description: "" }])}
          >
            ＋ Trait
          </button>
        </div>
      </div>
    </EditorModal>
  );
}
