# Plan: 5e SRD Compendium (2024 rules) — classes, spells, items, monsters

## Context

The character sheet has no way to pick a class: `characterClass` is free text with **no editing UI anywhere** — it's only displayed read-only in [SheetHeader.tsx:35-37](src/components/sheet/SheetHeader.tsx#L35-L37) and the class-chip in [FeaturesPage.tsx:127-131](src/components/sheet/pages/FeaturesPage.tsx#L127-L131). The "search box" the user saw under the class is the generic RowTable row-filter (filters the character's own feature rows — empty for a new character), not a class search. There is no 5e reference content in the app at all; every spell/item/feature is hand-typed.

**Goal:** ship a read-only 5e "compendium" (**2024 rules / SRD 5.2.1**, legally free under CC-BY-4.0) plus picker UIs:
- **Class/subclass picker** — players on their own sheet, DM on NPCs. Default = names only; opt-in **"Autofill basics"** checkbox per pick (hit die, save/armor/weapon/tool proficiencies, spellcasting ability, skill choices).
- **Species picker + feat picker** — player-facing build options (same treatment as class, NOT the DM-only item treatment). The sheet's `race` field is currently orphaned — never displayed or edited anywhere.
- **Multiclassing support** — per the user-provided [multiclassing-spec.md](multiclassing-spec.md) ("loose consideration"), adapted in Step 8 below. Backgrounds were explicitly NOT selected — stay free text; can ride the same pattern later.
- **Monster picker** — DM-only, creates NPC sheets from SRD stat blocks.
- **Spells / equipment / magic items pickers** — DM-only, contextual in add-flows (never an always-visible browse panel). Players only see what's on their sheet; their manual blank-row entry is unchanged. Enforcement is UI-level only (static JSON is publicly fetchable — accepted: it's public SRD content; restriction preserves table experience, not secrecy. No server gating by design.)

**Data sources (mixed — no single 2024 source is complete):**
- **Classes, subclasses, equipment, magic items:** [5e-bits/5e-database](https://github.com/5e-bits/5e-database) `src/2024/en/` JSON (MIT repo, powers dnd5eapi.co). Verified: the 2024 Classes file keeps the 2014-style schema (`hit_die`, `saving_throws`, `proficiencies`, `proficiency_choices` choose-N-skills, `spellcasting` on casters, `subclasses`) — the autofill mapping works unchanged. Pinned by commit SHA.
- **Spells + monsters:** [Open5e API v2](https://api.open5e.com/v2/) filtered `document__key=srd-2024` — 5e-bits has no 2024 spells and only stub monsters. Verified: 339 spells (structured level/school/casting_time/range/components/duration/concentration/ritual/classes/damage_roll/higher_level), 331 creatures (structured ability_scores, saving_throws/skill_bonuses as final bonuses, speed object, senses, CR, actions with attack/damage info).
- Both derive from SRD 5.2/5.2.1 (CC-BY-4.0). Our compendium schema is our own, so sources can be swapped later (e.g. when 5e-bits finishes its 2024 set).

**Hard constraint:** all campaign state lives in one `GameState` in PartyKit storage — `MAX_CAMPAIGN_BYTES = 900_000`, `MAX_SHEET_BYTES = 20_000` ([types.ts:1395](src/lib/types.ts#L1395) area). Compendium data must stay OUT of GameState; pickers copy self-contained rows into sheets (existing pattern — inventory rows are display copies, [types.ts:656-659](src/lib/types.ts#L656-L659)).

**Verified plumbing to reuse:**
- `SheetEdit` context already carries `isDm`, `canEdit`, `update(patch)` ([context.ts:23-36](src/components/sheet/context.ts#L23-L36)) — every sheet page can gate DM-only UI and write multi-field patches with zero new plumbing.
- Sheet skill ids (`skill-acrobatics`, `skill-sleight-of-hand`… [types.ts:1930-1945](src/lib/types.ts#L1930-L1945)) are **string-identical** to 5e-bits proficiency indexes → class skill choices map by identity.
- `Directory.tsx` already supports a second create button (`onCreatePlayer`, [Directory.tsx:382-386](src/components/Directory.tsx#L382-L386)) — precedent for an `extraCreate` prop.
- Modal pattern: `AssetPickerModal.tsx` (portal, Esc/click-outside close); search styling: `RowTable.tsx` `rt-search`.
- Lazy-load precedent: dice engine dynamic imports ([useDiceOverlay.ts:195+](src/dice/useDiceOverlay.ts#L195)).
- NPC creation: `dm.createSheet(id, name)` then ordered `dm.updateSheet(id, patch)` (pattern comment ActorsPanel.tsx:123-124).

## Step 1 — Data pipeline (ships dark)

**New:** `scripts/build-compendium.mjs` (plain Node, native fetch, zero deps) + npm script `"compendium"`.
- **From 5e-bits** (`raw.githubusercontent.com/5e-bits/5e-database/<PINNED_SHA>/src/2024/en/`): Classes, Subclasses, Equipment, Magic-Items, **Species, Subspecies, Traits, Feats**, + Proficiencies (build-time only, to classify class proficiency refs into armor/weapon/tool buckets). Resolve the SHA as the first implementation act. Transforms: resolve `{index,name,url}` API refs to strings, join `desc[]` arrays; include 2024 weapon-mastery property in item `properties` when present; extract each class's `multi_classing` object (prerequisites + proficiencies — verified present in the source) into the class entries; merge Species+Subspecies with trait text resolved into descriptions.
- **From Open5e v2 API** (`api.open5e.com/v2/spells/` and `/v2/creatures/` with `?document__key=srd-2024`, following pagination `next` links): spells + monsters. Transforms: `casting_time "action"→"1 action"`; components booleans → `"V, S, M"` string with `material_specified` folded into description; `higher_level` text appended to description; `damage_roll`→`roll`; classes array → lowercase class ids; creature `speed` object → `walkSpeed` + `speedLine`; senses fields (`darkvision_range`, `passive_perception`) → `senses` line; CR float → display string (`0.125→"1/8"`); prof bonus derived from CR (`ceil(CR/4)+1`) when absent; action attack/damage parsed from structured fields with regex fallback on description text (`"+7 to hit"`, `"(2d6+5)"`). Casting times/ranges >40 chars truncated with overflow moved into description (server SHORT_CAP=40).
- Validate: assert expected counts (12 classes / 12 subclasses / **339 spells / 331 creatures** / equipment+magic-item minimums, exact counts recorded on first run) + required fields; exit non-zero on failure. Deterministic output (sorted, stable keys).
- **Write to `public/compendium/`**: `classes.json`, `subclasses.json`, `spells.json`, `equipment.json`, `magic-items.json`, `monsters.json`, `meta.json` (5e-bits SHA, Open5e fetch date + API version, counts, attribution). **Commit generated JSON to git** — offline dev, deterministic builds; the script exists for reproducibility/pin bumps. Note: the Open5e API isn't SHA-pinnable — reproducibility comes from the committed output; data only changes when we deliberately re-run the script.
- **Attribution (CC-BY-4.0 requirement):** full **SRD 5.2.1** attribution string in `meta.json` ("This work includes material from the System Reference Document 5.2.1 by Wizards of the Coast LLC, licensed under CC-BY-4.0…" + credits to 5e-bits (MIT) and Open5e), rendered as a muted footer in the picker modal, plus a README section.

## Step 2 — Loader + mappers (ships dark)

**New:** `src/lib/compendium.ts` — compendium types + `loadCompendium(category)` (lazy `fetch("/compendium/….json")` on first use, cached promise, cache cleared on rejection) + `searchCompendium(rows, query)` (trimmed `.toLowerCase().includes()` matching RowTable's pattern; name-prefix matches sort first; no new deps).

Schema highlights (full sketch in the design; all map 1:1 onto existing types):
- `CompendiumClass`: `id, name, hitDie, saves: ["int","wis"], armorProfs, weaponProfs, toolProfs, skillChoices: {choose, from}, spellcasting?: {abilityId, casterType}, subclassIds, subclassLevel, multiclass: { prereqs: [{abilityIds, min: 13, mode: "and"|"or"}], armorProfs, weaponProfs, toolProfs, skillChoice? }`. casterType via hard-coded name map (bard/cleric/druid/sorcerer/wizard=full, paladin/ranger=half, warlock=pact). Third-casters: the SRD's 12 subclasses include none (Champion Fighter, Thief Rogue — not Eldritch Knight/Arcane Trickster), so subclasses.json cannot carry third-caster data; instead the slot-pooling lookup (Step 8.6) hardcodes those two subclass names as exceptions.
- `CompendiumSpecies`: `id, name, size, speed, languages, traits: [{name, description}], subspecies?`.
- `CompendiumFeat`: `id, name, category, prerequisite?, description`.
- `CompendiumSpell`: `id, name, level, school, time, range, components, duration, concentration, ritual, classes, roll?, description` (full text kept for preview pane; trimmed on copy).
- `CompendiumEquipment` / `CompendiumMagicItem`: map onto `ItemType`/`ItemRarity`, cost/weight/damage/properties/attunement.
- `CompendiumMonster`: abilities, ac, hp, hitDice, speedLine, stated save/skill bonuses keyed `save-dex`/`skill-perception`, senses/languages, cr/xp/profBonus, resist/immune/vuln/condition arrays, traits/actions/legendary/reactions.

**New:** `src/lib/compendiumMap.ts` — pure, unit-testable mappers, every string pre-trimmed to the same caps `normalizeCharacterSheet` enforces (NAME_CAP=120, DESC_CAP=1000, SHORT_CAP=40, SHEET_ROW_CAPS) so local draft == server-normalized result:
`spellEntryFromCompendium`, `inventoryRowFromEquipment/MagicItem` (via `createInventoryRow` + `inventoryCategoryForItemType`), `itemRecordFromEquipment/MagicItem`, `classAutofillPatch`, `monsterSheetPatch`.

## Step 3 — Shared picker modal (ships dark)

**New:** `src/components/CompendiumPickerModal.tsx` — generic, modeled on AssetPickerModal (portal, `modal-backdrop`/`modal`, Esc + click-outside) with `rt-search`-style input. Props: `title, load, getSearchText, columns, renderPreview, filters?, footer?, multiPick?, onPick, onClose`. Two-pane body: scrollable row list left (plain `.map()`, ≤400 rows — no virtualization), full-text preview right; attribution footer. Loading/error/retry states. Parchment CSS in `src/index.css` (no default browser controls). Per-category columns: spell = level/school/time (+level & class filters); item = category/cost or rarity/attunement; monster = CR/type/size (+CR filter); class = hit die/saves/caster ability.

## Step 4 — Class/subclass picker (first visible feature)

**New:** `src/components/sheet/ClassPickerModal.tsx` wrapping the shared modal. Footer: subclass `<select>` (from subclasses.json, optional "—"), **"Autofill basics" checkbox (default OFF)**, and when ON + class has skillChoices, a "Choose N skills" checkbox grid (disables extras once N picked; zero-chosen allowed). Apply → ONE `sheet.update(classAutofillPatch(...))`.

**Trigger** ([FeaturesPage.tsx:127-131](src/components/sheet/pages/FeaturesPage.tsx#L127-L131)): PC class-chip becomes a button when `canEdit` (players get it on their own sheet automatically; server already permission-checks UPDATE_SHEET). NPC: compact "＋ Class" ghost-chip for `isNpc && canEdit` (DM) — FeaturesPage is the NPC landing page. SheetHeader untouched.

**Mapping** — names-only: `{ characterClass, subclass }` and nothing else. Autofill adds (additive merges, never removes):
| Compendium | Sheet write |
|---|---|
| hitDie | `hitDice.die = "d"+hitDie` (PC max derives from level) |
| saves | `saveProfs["save-int"]=1` … |
| armor/weaponProfs | union-dedupe into string arrays |
| toolProfs | append missing `ToolEntry` rows (cap 20) |
| spellcasting | `spellcasting.abilityId/casterType` → attack/DC + slots derive via rules5e |
| chosenSkills | `skillProfs[id]=1` each |

NPC nuance (tooltip): rules engine is off for NPCs — dots are display-only there; DM edits numbers manually as usual.

## Step 5 — DM-only spell/item pickers

DM gate = `sheet.isDm` on sheet pages; ItemsPanel already DM-only via `useDmActions`.
1. [SpellsPage.tsx](src/components/sheet/pages/SpellsPage.tsx) add-bar (~:171-176): third button "＋ From SRD" only when `canEdit && sheet.isDm`; multiPick; appends `spellEntryFromCompendium` rows. Works on NPC sheets and PC sheets the DM opens. Player buttons unchanged.
2. [InventoryPage.tsx](src/components/sheet/pages/InventoryPage.tsx): same "＋ From SRD" (DM only) opening **new** `src/components/sheet/SrdItemPickerModal.tsx` (two tabs: Equipment | Magic items = two picker configs), appends inventory rows.
3. [Directory.tsx](src/components/Directory.tsx): add optional `extraCreate?: { label, icon?, onClick }` second create button (clone of onCreatePlayer block :382-386).
4. [ItemsPanel.tsx](src/components/ItemsPanel.tsx): `extraCreate` "Add from SRD" → on pick `dm.createItem(id, name)` then `dm.updateItem(itemRecordFrom…(id, entry))` (ordered-message pattern already at :69-78). No "import all" button (GameState 900 KB budget; ~1 KB/item).

## Step 6 — Monster → NPC (DM-only)

Entry: [ActorsPanel.tsx](src/components/ActorsPanel.tsx) (serves Actors sidebar + NPCs page) — `extraCreate` "From SRD monster" → picker → `dm.createSheet(newId, monster.name)`; `dm.updateSheet(newId, monsterSheetPatch(monster))`; `openSheet(newId)`. New sheets start unrevealed (right default).

Mapping highlights: abilities→abilityScores; hp/ac/speed/cr/profBonus direct; initiative = DEX mod; **stated save/skill bonuses → `saveMods`/`skillMods` deltas** (`stated − abilityMod`) so NPC displayed totals equal the stat block exactly (NPC engine = mod + mods, rules5e.ts:337-341) — Open5e's `saving_throws`/`skill_bonuses` give final bonuses keyed by ability/skill name, mapped to `save-*`/`skill-*` ids; non-walk speeds + senses (incl. passive perception) → `senses` line; traits→`features` (source "other"), actions→`attacks` (manual toHit, damage ≤40, full text in notes), legendary/reactions→`features` prefixed rows; resist/immune/vuln/condition arrays direct; `source: "SRD 5.2.1"`.

**MAX_SHEET_BYTES safety:** descriptions pre-trimmed to 1000; guard re-trims to 500 if serialized patch > SHEET_SOFT_WARN_BYTES (18 KB); unit test maps ALL ~334 monsters through `monsterSheetPatch` + `normalizeCharacterSheet` and asserts < 20 KB.

## Step 7 — Species & feat pickers (player-facing)

- **Species picker:** `race` has no display today. Add a species chip next to the class chip on FeaturesPage (same modal pattern, `canEdit`); extend the PC SheetHeader subtitle to `"{race} {characterClass} {level}"`. Names-only default + autofill toggle → `size`, `speed`, languages union, species traits → `FeatureEntry` rows with `source: "species"` (the "Species Features" group already exists, [FeaturesPage.tsx:69](src/components/sheet/pages/FeaturesPage.tsx#L69)).
- **Feat picker:** "＋ From SRD" in the Features page add-bar for anyone with `canEdit` (players on their own sheet — build options follow the class treatment, not the DM-only item treatment). Adds `FeatureEntry` with `source: "feat"`, prerequisite line prepended to description.

## Step 8 — Multiclassing (adapted from [multiclassing-spec.md](multiclassing-spec.md))

Lands last — it builds on the class picker and touches the rules engine. Slices, each shippable:

1. **Data model** (types.ts + `normalizeCharacterSheet` migration): `CharacterSheet.classes: ClassEntry[]` — `{ id, className, subclassName, level, isFirstClass }` (spec §1). Migration: empty `classes` + `characterClass` set → seed one entry, `isFirstClass: true`. `characterClass`/`subclass` stay as display strings (UI syncs e.g. "Fighter 3 / Rogue 2"); `level` stays the authoritative TOTAL (normalizer enforces = sum of class levels when `classes` non-empty) → prof bonus + rules engine keep reading `sheet.level` unchanged (spec §4 satisfied by construction).
2. **Compendium-driven rules:** multiclass prereqs + proficiencies come from the 5e-bits `multi_classing` source data (spec §2's hand table is used only as a validation cross-check). `subclassLevel` stored per class (2024 SRD: level 3 for ALL classes — spec §8's variance is a 2014-ism).
3. **"Manage classes" UI:** ClassPickerModal grows into a class-list manager — rows with per-class level steppers, "＋ Add class" opens the picker. First class keeps the full autofill path; added classes apply `multiclass` proficiencies only, NEVER write `saveProfs`, and show a 1-skill choice only when the source data grants one (bard/ranger/rogue) (spec §3).
4. **Prereq gating** (spec §6): 13+ ability checks including every existing class's prereq; soft warning banner with "add anyway" (no persistent enforce-toggle initially — add later if asked).
5. **Hit dice per class** (spec §5): `hitDice` single `{current,max,die}` → pools `[{die, current, max}]` with normalizer migrating the old shape; sidebar hit-dice UI + server REST recovery updated. **Riskiest slice — own commit.**
6. **Spell slot pooling** (spec §7): rules5e derives pooled slots from combined caster level (full casters contribute level, half casters `floor(level/2)`, **third casters `floor(level/3)`**) using the existing `FULL_CASTER_SLOTS` table (the multiclass table is identical); warlock levels feed `PACT_SLOTS` separately, never merged.
   - **Third-caster exception:** Eldritch Knight (Fighter) and Arcane Trickster (Rogue) are official third-casters but are NOT in the SRD, so the compendium data can't mark them. The caster-type lookup checks the class entry's `subclassName` (normalized, since subclass is free text) against those two names first, falling back to the base-class map; matches contribute `floor(level/3)`. `CASTER_TYPES` already includes `"third"` ([types.ts:815](src/lib/types.ts#L815)) — no type change needed. Scoped to slot pooling ONLY — spell-list access/restrictions stay with subclass features as-is.
   - `spellcasting.casterType` remains the manual/homebrew override for sheets without a `classes` array. **Known limitation:** one `spellcasting.abilityId` per sheet → one DC/attack (manual overrides cover multi-caster edge cases); `SpellEntry` deliberately gains no source-class field yet (spec §7's Magical-Secrets warning).

## Rollout order (each independently shippable)
0. Copy this plan verbatim to a new md file in the repo root (user request)
1. Pipeline + loader + mappers + unit tests + README attribution (dark)
2. Shared picker modal + CSS (dark)
3. Class/subclass picker (FeaturesPage)
4. Species + feat pickers (FeaturesPage/SheetHeader)
5. DM spell picker (SpellsPage)
6. DM equipment/magic-item pickers (Directory/ItemsPanel/InventoryPage)
7. Monster → NPC (ActorsPanel)
8. Multiclassing (six slices above, in order)
9. Polish: filters, preview typography, attribution placement

## Verification
- `npm run build` after every step (tsc + vite); confirm `dist/compendium/*.json` emitted, NOT bundled into JS chunks.
- `npm run compendium` twice in a row → diff-clean (determinism; Open5e drift only appears on deliberate re-runs against a changed API); count/shape asserts pass (339 spells, 331 creatures, 12/12 classes/subclasses).
- Unit tests via repo pattern (tests/README.md): `npx esbuild tests/unit-compendium.test.ts --bundle --format=esm --platform=node --alias:@lib=./src/lib` → node. Cover: generated files parse; Wizard `classAutofillPatch` (d6, save-int/save-wis, INT/full) + names-only mode; Fireball entry ≤ caps; all-monsters size test; one low-CR creature round-trip (e.g. Goblin Warrior: AC/HP/skill bonus reproduced exactly via skillMods deltas).
- Runtime via **/verify skill** per step: pick Wizard w/ autofill + 2 skills → subtitle "Wizard 1", save dots, d6, derived DC; DM adds Fire Bolt from SRD; Items "Add from SRD" → Longsword (1d8 slashing, 15 gp) + drag-to-sheet still works; NPCs "From SRD monster" → pick a creature → sheet opens with stat block, sections unrevealed.
- Role check: connect as player — no SRD buttons on Spells/Inventory, class/species/feat pickers only on own sheet, blank-row adds unchanged.
- Species/feats: pick Elf w/ autofill → speed/size set, species trait rows appear in the Species Features group; add a feat → row in feats group with prerequisite line.
- Multiclassing: Fighter 3 + Wizard 2 → prof bonus reads +3 (total level 5), slots derive from combined caster level 2 (fighter contributes 0, wizard 2 → three 1st-level slots), hit dice show 3d10 + 2d6, prereq warning appears when STR and INT < 13; legacy single-class sheets migrate cleanly (normalizer unit test).
- Third-caster exception: Fighter 5 with subclass "Eldritch Knight" + Wizard 2 → combined caster level `floor(5/3) + 2 = 3` → caster-level-3 slots (4× 1st, 2× 2nd); same Fighter with subclass "Champion" contributes 0.

## Risks
- **Two data sources** (5e-bits + Open5e) means two transform paths in the script; mitigated by both feeding one validated compendium schema, and swappable later once 5e-bits completes its 2024 set.
- 5e-bits repo layout drift → pinned SHA insulates. Open5e API not pinnable → committed output insulates; re-runs are deliberate.
- Open5e creature actions: attack to-hit/damage may need regex parsing from description text where structured fields are absent — fallback is a row with text in notes and manual numbers (same as hand-entered NPC actions today).
- DM catalog bulk-import bloat → no import-all, trimmed descriptions, optional count warning past ~200 items.
- SHORT_CAP truncates a few long casting times/ranges (overflow moved to description) — acceptable.
- Concentration/ritual have no structured SpellEntry home → description prefix tags (decide "(C)" in components during step 4 — cosmetic).
- Magic-item generic parents ("+1 Weapon") + variants both kept; filter later if noisy.
- **Multiclassing is the biggest chunk** — data-model migration (classes array, hit-dice pools) touches normalizer, sidebar, server REST, rules engine. Mitigated by landing last in six independently-shippable slices, with migration unit tests. Spec corrections applied: 2024 subclasses all unlock at 3; prereq/proficiency tables from source data (spec's Druid line was uncertain); third-casters absent from SRD data but supported in slot pooling via the Eldritch Knight/Arcane Trickster subclass-name exception; single spell DC per sheet is a documented limitation.
