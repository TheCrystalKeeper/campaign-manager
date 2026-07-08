# Character-Sheet Automation Plan

**Status: Tiers 1–3 SHIPPED 2026-07-07 (designed and built the same day).** This is the
"automation is a separate future plan" that Phase 7 of `IMPLEMENTATION_PLAN.md`
deliberately deferred ("layout + manual fields FIRST, automation LATER"). This document
explains, in plain English, what is automated, exactly how it works, and why the
codebase was already shaped for it.

> **As built (2026-07-07):** shipped per this plan in three rounds, all machine-verified
> (`tests/unit-{rules5e,rollcheck,traits}.test.ts` + `tests/smoke-automation.mjs`
> end-to-end, plus the full pre-existing unit + smoke suites re-run green; a manual
> two-window feel pass is still owed). The engine lives in `src/lib/rules5e.ts`; totals
> are the sum of the same labeled parts the roll resolver uses, so display and rolls
> cannot drift. Deltas from the prose below:
>
> - **Override UI:** badges (Init/Prof), hit-dice max, capacity, and spell attack/DC are
>   directly editable derived numbers (commit = override; committing the formula's own
>   value returns to auto). Skill/save totals are roll buttons, so overriding those is
>   **right-click** on the total; the gold ● marker resets either way.
> - **Auto spell slots:** an absent stored slot entry means "never spent" = full; writes
>   store the effective max so a fully-spent level persists. "Cast" at 0 slots is
>   **rejected with a clear error** rather than the planned "cast anyway" override —
>   houserule tables just adjust slots by hand (pips/manual mode).
> - **Why a roll was adv/dis** is appended to its log label (e.g. "Stealth check
>   (dis: poisoned)", "(cancelled)") — there is no roll dialog to surface it in.
> - **`ROLL_CHECK.tokenId`** is in the protocol; the client doesn't send it yet — the
>   server's single-linked-token fallback covers the common case, and multi-token
>   shared stat blocks get no auto conditions (can't be guessed).
> - **Attack rows** (manual + inventory weapons) gained optional `toHitAbility`
>   ("auto to-hit": ability mod + prof, "spell" = casting ability) and a
>   **melee/ranged tag** that routes the 8 global attack/damage trait bonuses
>   (untagged rows skip them). Shift-click a damage roll = crit dice (doubled +
>   melee-crit-damage-dice extras on melee rows).
> - **Exhaustion** = flat disadvantage on ability checks (the level-1 effect; levels
>   aren't tracked on `Token.conditions`). Enhanced Dual Wielding + Tavern Brawler are
>   marked informational (they change action economy the app doesn't model).
> - **Short rest** is a small flyout on the 🍴 button (pick hit dice to spend; each
>   heals its die + CON, server-rolled). `initiativeBonus` now runs through the engine
>   for PCs, fixing the old sheet-badge vs combat-tracker inconsistency.

**Decisions locked (user, 2026-07-07):**

1. **Override style: auto + manual override.** The sheet computes every number, but you
   can still click any computed value and type your own — it gets an "overridden" marker
   and a reset-to-auto button. (This is how D&D Beyond works.)
2. **Depth: Tiers 1–3.** Derived numbers, smarter rolls, and action buttons. Tier 4 (a
   built-in rules content database) is documented at the end as a future step.
3. **Scope: PCs auto, NPCs manual.** Player-character sheets follow PC math. Monster
   stat blocks don't follow those formulas (you copy them from a book as-written), so
   NPC sheets keep working exactly like today — the override UI is simply always-on for
   them.

---

## 1. What this is

Today, every number on a character sheet is typed by hand. If Vex the rogue levels up,
someone has to remember to bump her proficiency bonus, then re-add it into Stealth,
Acrobatics, her saving throws, her attack bonus… and if they forget one, the sheet is
quietly wrong.

Automation flips this around: **you enter the few numbers that are genuinely choices**
(ability scores, level, which skills you're proficient in, which feats you have) **and
the app computes everything else** — live, everywhere, the same way D&D Beyond or
Foundry VTT do it. Change DEX from 14 to 16 and Stealth, Acrobatics, initiative, and
every DEX save update instantly, on the sheet, in the roll buttons, and in the roll log.

Three tiers, built in order:

| Tier | Name | One-line summary |
| --- | --- | --- |
| 1 | **Derived numbers** | Totals compute themselves from scores + level + proficiency dots. |
| 2 | **Smarter rolls** | The Special Traits page actually changes rolls (crits, rerolls, bonuses); token conditions grant advantage/disadvantage. |
| 3 | **Buttons that do things** | Short/Long Rest actually restore resources; casting spends a slot; death saves roll themselves; DM can apply damage respecting resistances. |

---

## 2. The 2-minute D&D math primer

Everything in Tier 1 is one of these six formulas. (Terms also in the Glossary, §11.)

**Ability modifier** — each of the six ability scores (STR/DEX/CON/INT/WIS/CHA,
usually 3–20) converts to a modifier: `(score − 10) ÷ 2, round down`.

| Score | 8 | 10 | 12 | 14 | 16 | 18 | 20 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Modifier | −1 | +0 | +1 | +2 | +3 | +4 | +5 |

*Example: Vex has DEX 16 → her DEX modifier is +3.* (The app already computes this one —
it's the only derivation that exists today.)

**Proficiency bonus** — a single bonus that grows with character level:
`2 + (level − 1) ÷ 4, round down`.

| Level | 1–4 | 5–8 | 9–12 | 13–16 | 17–20 |
| --- | --- | --- | --- | --- | --- |
| Bonus | +2 | +3 | +4 | +5 | +6 |

**Skill / saving-throw total** — `ability modifier + proficiency (if proficient)`.
Being *proficient* means you add your proficiency bonus; *expertise* (the double dot)
means you add it twice. *Example: Vex, level 3 (prof +2), expertise in Stealth,
DEX 16: Stealth = 3 + 2×2 = **+7**.*

**Passive score** — `10 + the skill total`. Used by the DM secretly ("does anyone
notice the trap?"). *Vex's passive Perception with +5 Perception = 15.*

**Initiative** — a DEX check that decides turn order in combat: `DEX modifier`
(+ feats like Alert).

**Spellcasting numbers** — casters pick one ability (e.g. Wisdom for clerics):
save DC = `8 + proficiency + casting ability modifier`; spell attack =
`proficiency + casting ability modifier`.

**Carry capacity** — `STR score × 15` pounds (×2 for Powerful Build).

Two roll mechanics matter for Tier 2: **advantage/disadvantage** (roll two d20s, keep
the higher/lower — sources never stack, and one of each cancels out) and **critical
hits** (a natural 20 on an attack — some feats widen this to 19–20).

**Rests** (Tier 3): a **short rest** (~1 hour) lets you spend **hit dice** (one per
level; roll it + CON modifier to heal) and recharges some abilities; a **long rest**
(overnight) restores all HP, half your hit dice, all spell slots, and most abilities.

---

## 3. Good news: the hooks are already built

Phase 7 left deliberate, currently-inert hooks. Each one maps directly onto a piece of
this plan — that's why this feature is cheaper than it sounds:

| Existing hook (already shipped & stored) | What it does today | What will consume it |
| --- | --- | --- |
| Proficiency dots `skillProfs` / `saveProfs` (`src/lib/types.ts:799-802`) | Rendered as cycling dots — **feed nothing** ("display-only" by design) | Tier 1: `dot × proficiency bonus` folded into every total |
| `proficiencyBonus` field (`types.ts:787`) | Hand-typed number, default 2 | Tier 1: computed from `level`, override-able |
| `traits` map + `src/components/sheet/traitDefs.ts` (27 switches: 12 feats, 3 species traits, 12 global bonuses) | Toggles/number inputs that persist but **no math reads** | Tier 2: every switch wired into roll resolution |
| `resolveCheck()` (`src/lib/rollCheck.ts:54`) | Resolves sheet rolls server-side; its own docs call it *"the seam for a future rules engine"* (`types.ts:1127`) | Tiers 1–2: THE place the engine plugs in |
| `FeatureEntry.recovery: "sr" \| "lr"`, feature `uses`, item `charges`, `spellSlots`, `hitDice`, `deathSaves`, `hp.temp` | Stored + editable, nothing automatic | Tier 3: rest/cast/use buttons mutate them |
| `REST` message (`partykit/server.ts:660`) | **Log-only stub** — comment says "log-only hook today (manual-fields-first)" | Tier 3: becomes a real rest that restores resources |
| `ADJUST_HP` message (`server.ts:677`) | Already clamps/mutates HP server-side, temp HP first | Tier 3: reused by damage-apply and death-save results |
| Resistance/immunity/vulnerability pills | Display-only text pills | Tier 3: damage-apply halves/zeroes/doubles |
| `Token.conditions` (all 15 5e conditions + `concentrating`, `types.ts:379`) | Badges on tokens | Tier 2: advantage/disadvantage on rolls; Tier 3 stretch: concentration prompts |
| Equipped-weapon → attacks union (`FeaturesPage.tsx:32-35` + `rollCheck.ts:31`) | Already "computed, never stored", rebuilt identically on client and server | The **pattern** the whole engine copies |

---

## 4. The core design: one shared rules engine

### 4.1 A single pure module, used by both the screen and the server

New file **`src/lib/rules5e.ts`**: pure functions (no network, no state) —
the heart is `computeDerived(sheet) → Derived`, returning proficiency bonus, every
skill/save total, passives, initiative, carry capacity, spell DC/attack, hit-dice max.

It gets called from **both** places that already share math today:

- **The sheet UI** (`MainPage`, `SheetSidebar`, `InventoryPage`) displays engine output
  instead of raw stored numbers.
- **The server's `resolveCheck`** uses engine output when resolving a roll — so the
  number on your screen and the number the dice actually use **cannot disagree**, and
  players can't cheat (rolls stay server-authoritative with `secureRandInt`, exactly
  like today).

### 4.2 Computed, never stored

Derived values are **never written into GameState**. They're recomputed on the fly from
the inputs, the same way equipped weapons already become attack rows. This matters
because of two hard project constraints: every stored field bloats the full-state
broadcast (20KB/sheet cap), and every stored field needs redaction rules. Derived-only
values dodge both entirely.

### 4.3 Overrides (the one new stored field)

`CharacterSheet.overrides: Record<string, number>` — keys like `"prof"`,
`"skill-stealth"`, `"save-dex"`, `"init"`, `"spell-dc"`, `"carry-capacity"`.

- Empty for everyone by default (auto mode).
- Click a computed total → type a number → it's stored in `overrides`, shown with a
  small dot marker and a "↺ auto" reset. The engine returns the override verbatim for
  that stat.
- Joins the `traits` section in `SHEET_SECTION_FIELDS` (`types.ts:898`) alongside
  `traits`/`favorites` (the every-key-in-exactly-one-section invariant test stays
  green), gets a sanitizer in `normalizeCharacterSheet`, and a key-count cap (~80).

### 4.4 What happens to the existing manual modifier boxes

`skillMods`/`saveMods` are **kept and relabeled "Misc"** — a flat bonus added *on top*
of the automatic total (D&D Beyond has the same box; it's where "+1 from a magic item"
goes). Nothing is deleted, no migration rewrites your data.

**Honest migration note:** a sheet that *both* has proficiency dots set *and* had the
proficiency hand-baked into its Misc box would double-count after the update. Rather
than silently rewriting numbers, the sheet shows a one-time soft warning chip on such
rows ("possible double-count — clear misc bonus?") with a one-click fix. Sheets that
never set the (previously decorative) dots are unaffected — their totals don't change
until dots are set.

### 4.5 NPCs stay manual

The engine only runs for `kind === "pc"` sheets. NPC sheets keep today's behavior
(ability-mod + misc), because monster stat blocks are copied from books as-written and
don't follow PC formulas. (A per-NPC "use PC math" toggle is a possible later nicety.)

---

## 5. Tier 1 — numbers that compute themselves

| Field | Formula (auto) | Inputs | Where it shows | Override key |
| --- | --- | --- | --- | --- |
| Proficiency bonus | `2 + ⌊(level−1)/4⌋` | `level` | Sidebar "Prof" badge | `prof` |
| Skill totals (×18) | `ability mod + dot×prof + misc` | scores, `skillProfs`, `skillMods` | Main page skill rows + roll buttons | `skill-{id}` |
| Save totals (×6) | `ability mod + dot×prof + misc` | scores, `saveProfs`, `saveMods` | Main page saves + roll buttons | `save-{id}` |
| Passive scores | `10 + skill total` | skill totals | Main page passive column | — (follows skill) |
| Initiative | `DEX mod + misc` | DEX score | Sidebar badge, combat tracker | `init` |
| Carry capacity | `STR score × 15 × multiplier` | STR, `carryMultiplier` | Inventory encumbrance bar | `carry-capacity` |
| Spell save DC | `8 + prof + casting ability mod` | `spellcasting.abilityId` | Spells page | `spell-dc` |
| Spell attack | `prof + casting ability mod` | `spellcasting.abilityId` | Spells page + roll button | `spell-attack` |
| Hit dice max | `= level` | `level` | Sidebar hit-dice bar | `hit-dice-max` |
| Weapon to-hit *(opt-in per attack)* | `STR-or-DEX mod + prof` | new per-attack ability picker | Attack rows | per-row manual stays |

Notes:

- **Initiative** today is a stored flat number that the combat tracker *adds to* a
  DEX-derived bonus (`server.ts:209-213` computes `dexMod + initiative`) while the
  sheet roll button uses the flat number alone — a real inconsistency the engine
  removes: one formula, used everywhere.
- **Weapon to-hit** is opt-in per attack row: a small "auto" toggle plus an ability
  picker (STR / DEX / spellcasting ability, for finesse and pact weapons). Rows without
  it keep their typed number — monster attacks and homebrew stay trivially manual.
- **Cheap add-on — spell-slot maximums without any database:** a "caster type" dropdown
  on the Spells page (`none / full / half / third / pact`), stored as one new
  `spellcasting.casterType` field. The five slot progressions are one tiny static table
  from the free basic rules (a full caster at level 3 has 4/2 slots; a warlock's pact
  slots even recharge on short rest, which Tier 3 uses). Slot *maximums* then compute
  from `casterType + level`; current slots stay tracked as today.

**What stays manual, and why:**

- **AC** — computing it needs armor rules (Chain Mail = 16 flat, Leather = 11+DEX, …),
  i.e. item data the app doesn't have → Tier 4. The AC shield stays a typed number.
- **Max HP** — depends on rolled-or-average choices per level → stays typed (the
  double-count-free formula needs class hit-die data anyway).
- **Hit-die type** (d6/d8/d10/d12), **speed**, **senses**, **languages**, item weights,
  spell descriptions — genuine content, not math.
- **Level** stays the input (no XP→level auto; groups often use milestone leveling).

---

## 6. Tier 2 — rolls that know the rules

All of this lands inside `resolveCheck()` + the engine — server-side, so it's
tamper-proof and shows up in everyone's roll log with honest breakdown chips (the
`"prof"` chip color finally means *proficiency*, not "whatever was typed").

### 6.1 Every existing Special-Traits switch, wired up

| Trait (already in `traitDefs.ts`) | Effect when toggled on |
| --- | --- |
| Jack of All Trades | +⌊prof/2⌋ to ability checks you're *not* proficient in (incl. initiative) |
| Remarkable Athlete | +⌈prof/2⌉ to STR/DEX/CON checks you're not proficient in, and initiative |
| Reliable Talent | On proficient skill checks, a d20 result below 10 counts as 10 |
| Diamond Soul | Proficiency added to **all** saving throws |
| Alert Feat | Proficiency added to initiative |
| Advantage on Initiative | Initiative rolls get advantage |
| Observant Feat | +5 to passive Perception and passive Investigation |
| Halfling Lucky | Natural 1s on d20s are rerolled once (log shows both dice) |
| Elven Accuracy | When you have advantage on a DEX/INT/WIS/CHA d20 roll, roll 3 dice keep highest |
| Powerful Build | Carry capacity doubled |
| Weapon/Spell Crit Threshold (numbers) | Attack rolls mark **CRIT** at ≥ the threshold (e.g. 19), not just 20 |
| Melee Crit Damage Dice (number) | Crit damage rolls add that many extra weapon dice |
| 12 Global Bonuses (numbers) | Flat bonuses folded into their matching roll kind (melee/ranged × weapon/spell × attack/damage, plus global check / save / skill / spell-DC) |
| Enhanced Dual Wielding, Tavern Brawler | Informational only for now — they change *action economy / weapon eligibility*, which the app doesn't model. Shown with an "ℹ no automatic effect" note instead of pretending. |

To route the melee/ranged global bonuses correctly, attack rows gain an optional
`melee | ranged` tag (untagged rows just skip those bonuses).

### 6.2 Conditions grant advantage/disadvantage automatically

When a roll comes from a token (the sheet's linked token, or an explicit `tokenId` the
roll button now sends), the engine reads `Token.conditions`:

| Condition on the roller | Automatic effect on their rolls |
| --- | --- |
| Poisoned | Disadvantage on attack rolls and ability checks |
| Prone | Disadvantage on attack rolls |
| Blinded | Disadvantage on attack rolls |
| Restrained | Disadvantage on attack rolls and DEX saves |
| Frightened | Disadvantage on attack rolls and ability checks |
| Exhaustion | Disadvantage on ability checks (level-1 effect; deeper levels are a Tier 4 refinement) |

5e's stacking rule is applied properly: any number of advantage sources + any number of
disadvantage sources → they cancel to a plain roll; the roll dialog shows *why* ("dis:
poisoned") and Shift/Alt click still lets a human overrule the engine — the DM is
always right.

Effects that depend on the *target* (e.g. attacking an invisible creature) need a
targeting system the app doesn't have — out of scope until Tier 4+.

### 6.3 Crits become visible

Attack rolls whose kept d20 meets the crit threshold get a highlighted **CRIT** chip in
the log; a crit'd attack offers a "roll crit damage" variant (weapon dice doubled +
melee-crit-damage-dice extras). No auto-application to targets — the DM still narrates.

---

## 7. Tier 3 — buttons that do things

These are server mutations (new/upgraded messages), all logged, all respecting the
DM-any-sheet / player-own-sheet authorization that every sheet message already uses.

### 7.1 Rests become real (`REST` stub → actual effects)

- **Short Rest 🍴:** a small dialog to spend hit dice — each die spent rolls
  `hit die + CON mod` (server-rolled, logged like any roll) and heals that much.
  Restores features with `recovery: "sr"` and pact-caster spell slots.
- **Long Rest ⛰:** HP → max, temp HP cleared, regain `⌊max/2⌋` hit dice (min 1), all
  spell slots, features with `recovery: "sr"` or `"lr"`, death saves reset.
- Both post a summary log entry ("Vex finished a long rest: +9 HP, 1 hit die, all
  slots").

### 7.2 Spending resources

- **Cast** button on a spell row spends a slot of its level (cantrips don't); disabled
  at 0 slots with an override ("cast anyway") because tables houserule things.
- **Use** on a feature decrements `uses.current`; item **charges** likewise.

### 7.3 Death saves roll themselves

The skull tracker gets a roll button (players at 0 HP, or the DM): server rolls d20 —
**10+** marks a success, **9−** a failure, **natural 1** two failures, **natural 20**
the character regains 1 HP and the tracker resets. Three successes → stable; three
failures → a clearly-logged death message. (Auto-failure when damaged at 0 HP is a
stretch goal.)

### 7.4 DM damage-apply that knows resistances

On any damage roll in the log, the DM gets an **Apply to…** action: pick target
token(s) → the server matches the roll's damage type against the target sheet's
resistance/immunity/vulnerability pills (case-insensitive text match) → half / zero /
double, temp HP eaten first (the existing `ADJUST_HP` path). A confirm popup shows the
math before it lands ("14 fire → Ember is resistant → 7"), because the pills are
free-text and fuzzy matching should never silently be wrong.

### 7.5 Stretch (documented, not committed)

Concentration support: the `concentrating` condition already exists on tokens; when a
concentrating creature takes applied damage, prompt the DM for the CON save
(DC = max(10, half damage)). Fits cleanly after 7.4.

---

## 8. Multiplayer & safety (why this can't break the game)

- **The engine is pure** → table-driven unit tests for every formula and trait, no
  server needed.
- **No new broadcast weight:** derived values are never stored or sent; the only new
  stored fields are `overrides`, `spellcasting.casterType`, and per-attack
  `abilityId`/`melee-ranged` tags — each tiny, capped, normalized in
  `normalizeCharacterSheet`, and slotted into `SHEET_SECTION_FIELDS` (its invariant
  test keeps redaction leak-free automatically).
- **Redaction untouched:** players still never receive unrevealed NPC data; derived
  math changes nothing about what's sent.
- **Server authority unchanged:** every roll and every Tier-3 mutation happens
  server-side from the server's copy of the sheet with `secureRandInt` — a modified
  client can't fake a Stealth total or a rest.
- **Escape hatches everywhere:** per-field overrides, Misc boxes, manual adv/dis
  clicks, "cast anyway". Automation proposes; the DM disposes.

---

## 9. Build order & verification

Three rounds, each independently shippable and green on `npm test` + `npx tsc` +
`npm run build` (the pattern every phase has followed):

- **Round A — engine + Tier 1 + overrides.** `rules5e.ts`, `computeDerived`, UI reads
  engine output, override UI, Misc relabel, double-count warning chip, caster-type
  dropdown. Tests: formula tables (modifier/prof/skill/save/passive/capacity/DC),
  override precedence, the SHEET_SECTION_FIELDS invariant, NPC sheets byte-identical to
  today.
- **Round B — Tier 2 in `resolveCheck`.** Traits + conditions + crit thresholds +
  rerolls; `ROLL_CHECK` gains optional `tokenId`. Tests: one per trait id (27), adv/dis
  cancellation, Halfling-Lucky reroll parts, crit flag; smoke test the new message
  field.
- **Round C — Tier 3 mutations.** Real `REST`, `CAST_SPELL`, `USE_FEATURE`,
  `DEATH_SAVE`, `APPLY_DAMAGE`. Tests: rest restores exactly per §7.1, slot clamping,
  death-save edge cases (nat 1/20), resistance math; WS smoke suite extension
  (authorization: player can't rest someone else's sheet).

Manual feel-check after each round in two browser windows (DM + player), same as every
prior phase.

---

## 10. Future: Tier 4 — a built-in rules database

Everything above is *math over your own entries*. The next leap is *content*: free,
legally-usable SRD data (via [open5e.com](https://open5e.com/) or
[dnd5eapi.co](https://www.dnd5eapi.co/), both free/MIT-licensed APIs over the official
free rules) bundled or cached into the app. That unlocks: equip Chain Mail → AC
computes; pick "Wizard 5" → slots, hit die, and save proficiencies auto-fill; browse
real spells/monsters/items instead of typing them. It's a separate plan because it
adds content pipelines, storage questions (R2 budget), and licensing hygiene — none of
which Tiers 1–3 need.

**2014 vs 2024 rules note:** every formula in Tiers 1–3 is identical in both editions
(modifiers, proficiency, DCs, rests). Only content-level details differ (what specific
feats/species grant), which is exactly the Tier 4 boundary — so this plan doesn't need
to pick an edition.

---

## 11. Glossary

- **Ability score / modifier** — the six core stats (3–20); the modifier is the number
  you actually add to rolls: `(score−10)/2` rounded down.
- **Proficiency bonus** — your "trained in this" bonus, +2 to +6 by level.
- **Proficient / Expertise** — add proficiency once / twice to that skill or save.
- **Saving throw (save)** — a defensive roll to resist an effect (e.g. DEX save vs a
  fireball).
- **Passive score** — 10 + skill total; the DM checks it silently instead of asking
  for a roll.
- **Initiative** — the roll deciding turn order in combat.
- **Advantage / disadvantage** — roll 2d20 keep highest / lowest; sources don't stack
  and opposite sources cancel.
- **Critical hit (crit)** — natural 20 on an attack (or 19+ with certain feats): the
  attack hits and rolls double damage dice.
- **Spell save DC** — the number targets must beat to resist your spells.
- **Spell slots** — per-day spell fuel, by spell level; long rests refill them
  (warlock "pact" slots refill on short rests too).
- **Hit dice** — your per-level healing pool, spent on short rests.
- **Death saving throws** — at 0 HP: d20 each turn, three successes stabilize you,
  three failures kill you.
- **Temp HP** — a buffer of bonus hit points that's consumed before real HP.
- **Resistance / immunity / vulnerability** — take half / none / double damage of a
  given type.
- **Concentration** — some spells stay active only while the caster maintains focus;
  taking damage forces a CON save or the spell drops.
- **SRD (System Reference Document)** — the subset of official D&D rules released
  under a free license, which apps may legally build in.

---

## 12. Sources

- [D&D Beyond — Sheet Sections support article](https://dndbeyond-support.wizards.com/hc/en-us/articles/7747193946388-Sheet-Sections) (what a mainstream sheet auto-computes)
- [D&D Beyond forums — proficiency auto-application discussion](https://www.dndbeyond.com/forums/d-d-beyond-general/general-discussion/175209-proficiency-bonuses-and-dndb-character-sheets)
- [Foundry VTT — Active Effects](https://foundryvtt.com/article/active-effects/) and the [dnd5e Active Effect guide](https://github.com/foundryvtt/dnd5e/wiki/Active-Effect-Guide) (how Foundry models stat-modifying effects)
- [Foundry VTT — Rest Recovery module](https://foundryvtt.com/packages/rest-recovery) (rest automation scope)
- [open5e.com](https://open5e.com/) · [dnd5eapi.co](https://www.dnd5eapi.co/) (free SRD APIs for Tier 4)
