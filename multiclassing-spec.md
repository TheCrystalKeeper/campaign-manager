# Multiclassing spec (extends Step 4 plan)

## 1. Data model: classes becomes an array

Change from `{ characterClass, subclass }` to:

```
classes: [
  { classId, subclassId, level, isFirstClass: bool }
]
```

`isFirstClass` marks whichever class was taken at character level 1. This flag drives which proficiency table gets applied, so it needs to persist, not just be inferred from array order (in case of reordering/editing later).

## 2. Compendium schema needs two proficiency lists per class, not one

Right now each class entry presumably has one `armorProfs`/`weaponProfs`/`toolProfs`/`saveProfs` set. Split into:

- `startingProficiencies` (current full list, only ever applied when `isFirstClass`)
- `multiclassProficiencies` (new, smaller list, applied for every class after the first)

Multiclass proficiencies never include saving throws. Example deltas (armor/weapons only, trim to what's actually in your compendium):

| Class | Multiclass grants |
|---|---|
| Barbarian | shields, simple weapons, martial weapons |
| Bard | light armor, one skill of choice, one musical instrument |
| Cleric | light armor, medium armor, shields |
| Druid | light armor, medium armor, shields (nonmetal only) |
| Fighter | light armor, medium armor, shields, simple weapons, martial weapons |
| Monk | simple weapons |
| Paladin | light armor, medium armor, shields, simple weapons, martial weapons |
| Ranger | light armor, medium armor, shields, simple weapons, martial weapons, one skill of choice |
| Rogue | light armor, one skill of choice, thieves' tools |
| Sorcerer | none |
| Warlock | light armor, simple weapons |
| Wizard | none |

Only Bard, Ranger, and Rogue grant a skill choice on multiclass. Everyone else grants zero skills.

## 3. classAutofillPatch needs an isFirstClass branch

- `isFirstClass = true`: current behavior unchanged, apply `startingProficiencies`, save profs, full skill choice grid.
- `isFirstClass = false`: apply `multiclassProficiencies` only. Never write to `saveProfs`. Only show the skill-choice checkbox grid if the class is Bard/Ranger/Rogue, and cap at 1 chosen skill instead of N.

## 4. Proficiency bonus: always total character level

Sum all `classes[].level`, look up proficiency bonus from that total, never from an individual class's level. This probably already needs no change if it's already reading a `characterLevel` field, just confirm it's not accidentally reading `classes[0].level`.

## 5. Hit dice: per-class, not a single global die

Multiclass characters have mixed hit dice (e.g. 3d10 + 2d6). Change `hitDice.die` from a single string to an array:

```
hitDice: [
  { die: "d10", count: 3 },
  { die: "d6", count: 2 }
]
```

PC max HP still derives from summing each class's contribution at its own die type, same underlying rule as now, just no longer collapsible to one die type once a second class is added.

## 6. Multiclass prerequisites (gate on the "add class" action, not a stat effect)

Each class needs a `multiclassPrereq` field: one or two abilities, minimum score 13.

- Single ability: Barbarian (Str), Bard (Cha), Cleric (Wis), Fighter (Str or Dex), Sorcerer (Cha), Warlock (Cha), Wizard (Int), Rogue (Dex)
- Two abilities (both required): Druid (Str... actually Wis + one physical, verify per class), Monk (Dex + Wis), Paladin (Str + Cha), Ranger (Dex + Wis)

Important nuance: qualifying isn't just about the new class, the character must also still meet the prerequisite of every class they already have. (A Fighter/Rogue who lost Dexterity below 13 couldn't have taken that combo in the first place, and by extension shouldn't be able to add a third class without still clearing both existing thresholds.)

Recommend making this a soft warning with an "Enforce multiclass prerequisites" toggle (default on), not a hard block, since plenty of tables house-rule it off and D&D Beyond does the same.

## 7. Spellcasting: two separate pools

- **Standard multiclass slots**: derived from a combined caster level, not each class's own table. Full casters (Bard, Cleric, Druid, Sorcerer, Wizard) contribute their full level, half casters (Paladin, Ranger) contribute `floor(level / 2)`, third casters contribute `floor(level / 3)`. Sum those, then look up slots from the multiclass spell slot table. This applies to every spellcasting class **except** Warlock.
- **Warlock Pact Magic**: entirely separate pool, computed only from Warlock levels using Warlock's own slot table. Never merge into the pool above.

Spells known/prepared, spell lists, and cantrips stay tracked per class (each class references its own spell list and uses its own ability modifier for save DC/attack bonus), even though the slots themselves pool together.

Edge case to leave room for but not build now: some class features (like Bard's Magical Secrets) let you borrow spells from another class's list and count them as your own. Just don't hardcode an assumption that a spell's "source class" and "list it came from" are always the same field, or this becomes a rewrite later instead of an addition.

## 8. Subclass timing varies by class

Confirm `ClassPickerModal` already reads a per-class `subclassLevel` field rather than assuming level 1 for every class, since this matters more once multiclassing is live (each class's subclass unlocks on its own schedule, independent of total character level).
