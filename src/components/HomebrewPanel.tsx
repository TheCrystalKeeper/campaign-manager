import { useEffect, useState } from "react";
import {
  loadClasses,
  type CompendiumBackground,
  type CompendiumClass,
  type CompendiumFeat,
  type CompendiumSpecies,
  type CompendiumSpell,
  type CompendiumSubclass,
} from "../lib/compendium";
import type { GameState, HomebrewCategory } from "../lib/types";
import { rowId } from "../lib/types";
import type { useDmActions } from "../hooks/useGameRoom";
import { confirmDelete } from "./ConfirmDeleteDialog";
import {
  HomebrewBackgroundEditor,
  HomebrewClassEditor,
  HomebrewFeatEditor,
  HomebrewSpeciesEditor,
  HomebrewSpellEditor,
  HomebrewSubclassEditor,
  type ClassOption,
} from "./homebrew/HomebrewEditors";

/// <summary>
/// DM-only manager for homebrew compendium entries. Six category tabs, each listing the
/// campaign's entries with create/edit/duplicate/delete; entries appear in the matching
/// pickers with a "Homebrew" badge. Items and monsters are NOT managed here — they're
/// catalog items / NPC sheets flagged "Show in compendium" in their own editors (this
/// panel just says so).
/// </summary>

const TABS: Array<{ category: HomebrewCategory; label: string; singular: string }> = [
  { category: "classes", label: "Classes", singular: "class" },
  { category: "subclasses", label: "Subclasses", singular: "subclass" },
  { category: "spells", label: "Spells", singular: "spell" },
  { category: "backgrounds", label: "Backgrounds", singular: "background" },
  { category: "feats", label: "Feats", singular: "feat" },
  { category: "species", label: "Species", singular: "species" },
];

export function HomebrewPanel({
  state,
  dm,
}: {
  state: GameState;
  dm: ReturnType<typeof useDmActions>;
}) {
  const [tab, setTab] = useState<HomebrewCategory>("classes");
  /** null = closed; "new" = create; otherwise the id of the entry being edited. */
  const [editing, setEditing] = useState<string | null>(null);
  const [officialClasses, setOfficialClasses] = useState<CompendiumClass[]>([]);

  // If the entry under edit disappears (delete confirmed while its broadcast was in
  // flight, or a class deletion cascading away the subclass), close the editor instead
  // of letting a Save resurrect it under a fresh id.
  useEffect(() => {
    if (editing && editing !== "new" && !state.homebrew[tab][editing]) {
      setEditing(null);
    }
  }, [editing, tab, state.homebrew]);

  // Subclass/spell editors need the class list (official + homebrew) for their selects.
  useEffect(() => {
    let alive = true;
    loadClasses().then(
      (rows) => {
        if (alive) setOfficialClasses(rows);
      },
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, []);

  const classOptions: ClassOption[] = [
    ...officialClasses.map((c) => ({ value: c.id, label: c.name })),
    ...Object.values(state.homebrew.classes).map((c) => ({
      value: c.id,
      label: `${c.name} (homebrew)`,
    })),
  ];
  const classNameById = new Map(classOptions.map((c) => [c.value, c.label]));

  const activeTab = TABS.find((t) => t.category === tab)!;
  const entries = Object.values(state.homebrew[tab]).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  const initial = editing && editing !== "new" ? state.homebrew[tab][editing] : undefined;

  const saveEntry = (entry: { id: string }) => {
    dm.upsertHomebrew(tab, entry);
    setEditing(null);
  };

  const duplicateEntry = (id: string) => {
    const source = state.homebrew[tab][id];
    if (!source) return;
    dm.upsertHomebrew(tab, {
      ...source,
      id: rowId(`hb-${activeTab.singular}`),
      name: `${source.name} (copy)`,
    });
  };

  const deleteEntry = (id: string) => {
    const entry = state.homebrew[tab][id];
    if (!entry) return;
    void confirmDelete({
      kind: `homebrew ${activeTab.singular}`,
      name: entry.name,
      detail:
        tab === "classes"
          ? "Its homebrew subclasses are removed too. Sheets that already use it keep their copies."
          : "Sheets that already use it keep their copies.",
    }).then((ok) => {
      if (ok) dm.deleteHomebrew(tab, id);
    });
  };

  const editorProps = { onClose: () => setEditing(null) };

  return (
    <div className="panel-body stack">
      <div className="hb-tabs">
        {TABS.map((t) => (
          <button
            key={t.category}
            type="button"
            className={t.category === tab ? "cmp-tab cmp-tab--on" : "cmp-tab"}
            onClick={() => {
              setTab(t.category);
              setEditing(null);
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      <button className="btn-ghost" onClick={() => setEditing("new")}>
        ＋ New homebrew {activeTab.singular}
      </button>

      {entries.length === 0 ? (
        <p className="muted">No homebrew {activeTab.label.toLowerCase()} yet.</p>
      ) : (
        <div className="stack hb-list">
          {entries.map((entry) => (
            <div className="hb-row" key={entry.id}>
              <button className="hb-row-name" title="Edit" onClick={() => setEditing(entry.id)}>
                {entry.name}
                {tab === "subclasses" && "classId" in entry ? (
                  <span className="muted hb-row-sub">
                    {" "}
                    — {classNameById.get(entry.classId) ?? entry.classId}
                  </span>
                ) : null}
              </button>
              <button
                className="btn-ghost icon-btn"
                title={`Duplicate ${activeTab.singular}`}
                onClick={() => duplicateEntry(entry.id)}
              >
                ⧉
              </button>
              <button
                className="btn-ghost icon-btn"
                title={`Delete ${activeTab.singular}`}
                onClick={() => deleteEntry(entry.id)}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      <p className="muted hb-hint">
        Homebrew <strong>items</strong> are catalog items with “Show in item compendium” turned on
        (Items tab → item sheet). Homebrew <strong>monsters</strong> are NPC sheets with “Show in
        monster compendium” turned on. Edits here don't change sheets that already picked an entry —
        re-apply from the picker to update them.
      </p>

      {editing === null ? null : tab === "classes" ? (
        <HomebrewClassEditor
          initial={initial as CompendiumClass | undefined}
          onSave={saveEntry}
          {...editorProps}
        />
      ) : tab === "subclasses" ? (
        <HomebrewSubclassEditor
          initial={initial as CompendiumSubclass | undefined}
          classOptions={classOptions}
          onSave={saveEntry}
          {...editorProps}
        />
      ) : tab === "spells" ? (
        <HomebrewSpellEditor
          initial={initial as CompendiumSpell | undefined}
          classOptions={classOptions}
          onSave={saveEntry}
          {...editorProps}
        />
      ) : tab === "backgrounds" ? (
        <HomebrewBackgroundEditor
          initial={initial as CompendiumBackground | undefined}
          onSave={saveEntry}
          {...editorProps}
        />
      ) : tab === "feats" ? (
        <HomebrewFeatEditor
          initial={initial as CompendiumFeat | undefined}
          onSave={saveEntry}
          {...editorProps}
        />
      ) : (
        <HomebrewSpeciesEditor
          initial={initial as CompendiumSpecies | undefined}
          onSave={saveEntry}
          {...editorProps}
        />
      )}
    </div>
  );
}
