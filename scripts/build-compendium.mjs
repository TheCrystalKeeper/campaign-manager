// Builds public/compendium/*.json — the read-only 5e SRD 5.2.1 (2024 rules) dataset
// the in-app pickers search. Generated output is committed; re-run only to bump the
// pinned source or pick up upstream corrections:  npm run compendium
//
// Sources (both are SRD 5.2/5.2.1 content, CC-BY-4.0):
//  - 5e-bits/5e-database (pinned commit): classes, subclasses, species, feats,
//    equipment, magic items. The repo has no 2024 spells and only stub monsters.
//  - Open5e API v2 (document srd-2024): spells + creatures. Not pinnable — the
//    committed output is the reproducibility anchor.

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BITS_SHA = "46aa9f13dfa7d04ff121c2db3c568d9c673c870d";
const BITS_BASE = `https://raw.githubusercontent.com/5e-bits/5e-database/${BITS_SHA}/src/2024/en/`;
const OPEN5E_BASE = "https://api.open5e.com/v2/";
const OPEN5E_DOC = "srd-2024";

const OUT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public", "compendium");

const ATTRIBUTION =
  "This work includes material from the System Reference Document 5.2.1 (“SRD 5.2.1”) by Wizards of the Coast LLC, " +
  "available at https://www.dndbeyond.com/srd. The SRD 5.2.1 is licensed under the Creative Commons Attribution 4.0 " +
  "International License, available at https://creativecommons.org/licenses/by/4.0/legalcode. " +
  "Data via 5e-bits/5e-database (MIT) and Open5e.";

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res.json();
}

async function fetchBits(name) {
  return fetchJson(`${BITS_BASE}5e-SRD-${name}.json`);
}

/** Page through an Open5e v2 list endpoint, returning all results. */
async function fetchOpen5e(endpoint) {
  const results = [];
  let url = `${OPEN5E_BASE}${endpoint}/?document__key=${OPEN5E_DOC}&limit=100`;
  while (url) {
    const page = await fetchJson(url);
    results.push(...page.results);
    url = page.next;
  }
  return results;
}

const assert = (cond, msg) => {
  if (!cond) throw new Error(`Validation failed: ${msg}`);
};
const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const stripKey = (key) => key.replace(/^srd-2024_/, "");
const clean = (obj) => {
  // Drop undefined/null/empty-array/empty-string fields for lean, stable output.
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0)) delete obj[k];
  }
  return obj;
};

// ---------------------------------------------------------------------------
// Classes / subclasses
// ---------------------------------------------------------------------------

const CASTER_TYPES = {
  bard: "full",
  cleric: "full",
  druid: "full",
  sorcerer: "full",
  wizard: "full",
  paladin: "half",
  ranger: "half",
  warlock: "pact",
};

/** proficiency index -> bucket, via Proficiencies.json `type`. */
function buildProfClassifier(proficiencies) {
  const bucketByType = {
    Armor: "armor",
    Weapons: "weapons",
    Skills: "skills",
    "Saving Throws": "saves",
    "Artisan's Tools": "tools",
    Tools: "tools",
    "Musical Instruments": "tools",
    Other: "tools",
  };
  const map = new Map();
  for (const p of proficiencies) {
    const bucket = bucketByType[p.type];
    assert(bucket, `unknown proficiency type "${p.type}" (${p.index})`);
    map.set(p.index, { bucket, name: p.name.replace(/^Skill: /, "") });
  }
  return map;
}

/** Split a proficiency ref list into { armorProfs, weaponProfs, toolProfs }. */
function classifyProfs(refs, classifier) {
  const out = { armorProfs: [], weaponProfs: [], toolProfs: [] };
  for (const ref of refs ?? []) {
    const info = classifier.get(ref.index);
    assert(info, `unclassified proficiency ref ${ref.index}`);
    if (info.bucket === "armor") out.armorProfs.push(info.name);
    else if (info.bucket === "weapons") out.weaponProfs.push(info.name);
    else if (info.bucket === "tools") out.toolProfs.push(info.name);
    // saves are carried by saving_throws; skills don't appear as direct grants in 2024 classes
  }
  return out;
}

/** First proficiency_choices group made purely of skill-* options -> {choose, from}. */
function skillChoiceFrom(choices) {
  for (const group of choices ?? []) {
    const opts = group.from?.options ?? [];
    const indexes = opts.map((o) => o.item?.index).filter(Boolean);
    if (indexes.length && indexes.every((i) => i.startsWith("skill-"))) {
      return { choose: group.choose, from: indexes };
    }
  }
  return undefined;
}

function multiclassFrom(mc, classifier) {
  const prereqs = [];
  for (const p of mc.prerequisites ?? []) {
    prereqs.push({ abilityIds: [p.ability_score.index], min: p.minimum_score, mode: "and" });
  }
  const opt = mc.prerequisite_options;
  if (opt) {
    const abilityIds = (opt.from?.options ?? []).map((o) => o.ability_score.index);
    const min = (opt.from?.options ?? [])[0]?.minimum_score ?? 13;
    prereqs.push({ abilityIds, min, mode: "or" });
  }
  return clean({
    prereqs,
    ...classifyProfs(mc.proficiencies, classifier),
    skillChoice: skillChoiceFrom(mc.proficiency_choices),
  });
}

function transformClasses(rawClasses, rawSubclasses, classifier) {
  const subclassLevels = new Map();
  for (const sc of rawSubclasses) {
    const levels = (sc.features ?? []).map((f) => f.level).filter((n) => typeof n === "number");
    subclassLevels.set(sc.index, levels.length ? Math.min(...levels) : 3);
  }
  return rawClasses
    .map((c) => {
      const spellAbility = c.spellcasting?.spellcasting_ability?.index;
      const subclassIds = (c.subclasses ?? []).map((s) => s.index);
      return clean({
        id: c.index,
        name: c.name,
        hitDie: c.hit_die,
        primaryAbility: c.primary_ability?.desc,
        saves: (c.saving_throws ?? []).map((s) => s.index),
        ...classifyProfs(c.proficiencies, classifier),
        skillChoices: skillChoiceFrom(c.proficiency_choices),
        spellcasting: spellAbility
          ? { abilityId: spellAbility, casterType: CASTER_TYPES[c.index] ?? "full" }
          : undefined,
        subclassIds,
        subclassLevel: subclassIds.length ? Math.min(...subclassIds.map((id) => subclassLevels.get(id) ?? 3)) : 3,
        multiclass: multiclassFrom(c.multi_classing ?? {}, classifier),
      });
    })
    .sort(byId);
}

function transformSubclasses(rawSubclasses) {
  return rawSubclasses
    .map((sc) => {
      const features = (sc.features ?? [])
        .map((f) => `Level ${f.level} — ${f.name}. ${f.description}`)
        .join("\n\n");
      return clean({
        id: sc.index,
        name: sc.name,
        classId: sc.class.index,
        summary: sc.summary,
        description: [sc.description, features].filter(Boolean).join("\n\n"),
      });
    })
    .sort(byId);
}

// ---------------------------------------------------------------------------
// Species / feats
// ---------------------------------------------------------------------------

function transformSpecies(rawSpecies, rawSubspecies, rawTraits) {
  const traitById = new Map(rawTraits.map((t) => [t.index, t]));
  const resolveTraits = (refs) =>
    (refs ?? []).map((ref) => {
      const t = traitById.get(ref.index);
      assert(t, `unknown trait ref ${ref.index}`);
      // Ref names can be more specific than the trait record ("Darkvision (60 ft.)").
      return { name: ref.name ?? t.name, description: t.description };
    });
  const subspeciesByParent = new Map();
  for (const ss of rawSubspecies) {
    const parent = ss.species.index;
    if (!subspeciesByParent.has(parent)) subspeciesByParent.set(parent, []);
    subspeciesByParent.get(parent).push(
      clean({
        id: ss.index,
        name: ss.name,
        damageType: ss.damage_type?.name,
        traits: resolveTraits(ss.traits),
      }),
    );
  }
  return rawSpecies
    .map((sp) =>
      clean({
        id: sp.index,
        name: sp.name,
        creatureType: sp.type,
        size: sp.size,
        speed: sp.speed,
        traits: resolveTraits(sp.traits),
        subspecies: (subspeciesByParent.get(sp.index) ?? []).sort(byId),
      }),
    )
    .sort(byId);
}

function transformFeats(rawFeats) {
  return rawFeats
    .map((f) => clean({ id: f.index, name: f.name, category: f.type, description: f.description }))
    .sort(byId);
}

// ---------------------------------------------------------------------------
// Equipment / magic items
// ---------------------------------------------------------------------------

function equipmentItemType(categoryIds) {
  const has = (id) => categoryIds.includes(id);
  if (has("weapons")) return "weapon";
  if (has("armor") || has("shields")) return "armor";
  if (has("artisans-tools") || has("other-tools") || has("tools") || has("gaming-sets") || has("musical-instruments"))
    return "tool";
  return "gear";
}

function transformEquipment(rawEquipment) {
  return rawEquipment
    .map((e) => {
      const categoryIds = (e.equipment_categories ?? []).map((c) => c.index);
      const properties = (e.properties ?? []).map((p) => p.name);
      if (e.two_handed_damage) {
        const i = properties.indexOf("Versatile");
        const versatile = `Versatile (${e.two_handed_damage.damage_dice})`;
        if (i >= 0) properties[i] = versatile;
        else properties.push(versatile);
      }
      if (e.mastery) properties.push(`Mastery: ${e.mastery.name}`);
      const ac = e.armor_class;
      return clean({
        id: e.index,
        name: e.name,
        category: e.equipment_categories?.[0]?.name ?? "Gear",
        itemType: equipmentItemType(categoryIds),
        cost: e.cost ? `${e.cost.quantity} ${e.cost.unit}` : undefined,
        weight: e.weight,
        damage: e.damage?.damage_dice,
        damageType: e.damage?.damage_type?.name?.toLowerCase(),
        range: categoryIds.includes("weapons")
          ? categoryIds.includes("ranged-weapons")
            ? "ranged"
            : "melee"
          : undefined,
        properties,
        acBase: ac?.base,
        acDexBonus: ac?.dex_bonus,
        acMaxBonus: ac ? (ac.dex_bonus ? ac.max_bonus || undefined : undefined) : undefined,
        strMin: e.str_minimum || undefined,
        stealthDisadvantage: e.stealth_disadvantage || undefined,
        description: e.description,
      });
    })
    .sort(byId);
}

const MAGIC_ITEM_TYPES = {
  Armor: "armor",
  Weapons: "weapon",
  Potions: "consumable",
  Rings: "wondrous",
  Staffs: "wondrous",
  Wands: "wondrous",
  "Wondrous Items": "wondrous",
};

function magicRarity(name) {
  const simple = {
    Common: "common",
    Uncommon: "uncommon",
    Rare: "rare",
    "Very Rare": "very-rare",
    Legendary: "legendary",
    Artifact: "artifact",
  }[name];
  return simple ?? "varies";
}

function transformMagicItems(rawMagicItems) {
  return rawMagicItems
    .map((m) =>
      clean({
        id: m.index,
        name: m.name,
        itemType: MAGIC_ITEM_TYPES[m.equipment_category?.name] ?? "wondrous",
        category: m.equipment_category?.name ?? "Wondrous Items",
        rarity: magicRarity(m.rarity?.name),
        rarityText: magicRarity(m.rarity?.name) === "varies" ? m.rarity?.name : undefined,
        attunement: m.attunement || undefined,
        // true = concrete variant of a generic parent (e.g. "+1 Longsword" under "+1 Weapon")
        variant: m.variant || undefined,
        hasVariants: (m.variants ?? []).length > 0 || undefined,
        description: m.desc,
      }),
    )
    .sort(byId);
}

// ---------------------------------------------------------------------------
// Spells (Open5e)
// ---------------------------------------------------------------------------

function castingTime(raw) {
  const text = String(raw ?? "").replace(/[-_]/g, " ");
  if (/^(action|bonus action|reaction)$/.test(text)) return `1 ${text}`;
  // "1minute" / "10minutes" / "1hour" → "1 minute" / "10 minutes" / "1 hour"
  const timed = /^(\d+)\s*(minute|hour)s?$/.exec(text);
  if (timed) return `${timed[1]} ${timed[2]}${Number(timed[1]) > 1 ? "s" : ""}`;
  return text;
}

// Upstream Open5e data omissions, patched with the SRD 5.2.1 text (CC-BY-4.0).
const SPELL_DESC_PATCHES = {
  "greater-invisibility": "A creature you touch has the Invisible condition until the spell ends.",
};

function transformSpells(rawSpells) {
  return rawSpells
    .map((s) => {
      const comps = [s.verbal && "V", s.somatic && "S", s.material && "M"].filter(Boolean).join(", ");
      const descParts = [s.desc?.trim() || SPELL_DESC_PATCHES[stripKey(s.key)]];
      if (s.higher_level) descParts.push(`Using a Higher-Level Spell Slot. ${s.higher_level}`);
      if (s.material_specified) descParts.push(`Material: ${s.material_specified}`);
      if (s.reaction_condition) descParts.push(`Reaction trigger: ${s.reaction_condition}`);
      return clean({
        id: stripKey(s.key),
        name: s.name,
        level: s.level,
        school: s.school?.name,
        time: castingTime(s.casting_time),
        range: s.range_text || (s.range === 0 ? "Self" : `${s.range} ${s.range_unit ?? "feet"}`),
        components: comps,
        duration: s.duration,
        concentration: s.concentration || undefined,
        ritual: s.ritual || undefined,
        classes: (s.classes ?? []).map((c) => stripKey(c.key)),
        roll: s.damage_roll || undefined,
        saveAbility: s.saving_throw_ability || undefined,
        description: descParts.filter(Boolean).join("\n\n"),
      });
    })
    .sort(byId);
}

// ---------------------------------------------------------------------------
// Creatures (Open5e)
// ---------------------------------------------------------------------------

const ABILITY_IDS = {
  strength: "str",
  dexterity: "dex",
  constitution: "con",
  intelligence: "int",
  wisdom: "wis",
  charisma: "cha",
};

function crString(cr) {
  if (cr === 0.125) return "1/8";
  if (cr === 0.25) return "1/4";
  if (cr === 0.5) return "1/2";
  return String(cr);
}

function speedLine(speedAll) {
  if (!speedAll) return "";
  const parts = [];
  const unit = speedAll.unit ?? "feet";
  const suffix = unit === "feet" ? "ft." : ` ${unit}`;
  if (speedAll.walk) parts.push(`${speedAll.walk} ${suffix}`);
  for (const mode of ["fly", "swim", "climb", "burrow"]) {
    if (speedAll[mode]) parts.push(`${mode} ${speedAll[mode]} ${suffix}${mode === "fly" && speedAll.hover ? " (hover)" : ""}`);
  }
  return parts.join(", ");
}

function sensesLine(c) {
  const parts = [];
  if (c.darkvision_range) parts.push(`Darkvision ${c.darkvision_range} ft.`);
  if (c.blindsight_range) parts.push(`Blindsight ${c.blindsight_range} ft.`);
  if (c.tremorsense_range) parts.push(`Tremorsense ${c.tremorsense_range} ft.`);
  if (c.truesight_range) parts.push(`Truesight ${c.truesight_range} ft.`);
  if (c.passive_perception != null) parts.push(`Passive Perception ${c.passive_perception}`);
  return parts.join(", ");
}

/** "Bludgeoning, Piercing, and Slashing from..." keeps commas — split only on ';'. */
function splitResistList(display, list) {
  if (display) return display.split(";").map((s) => s.trim()).filter(Boolean);
  return (list ?? []).map((x) => x?.name ?? String(x)).filter(Boolean);
}

function attackFields(action) {
  const atk = (action.attacks ?? [])[0];
  if (atk && atk.to_hit_mod != null) {
    const die = atk.damage_die_type ? `${atk.damage_die_count ?? 1}${String(atk.damage_die_type).toLowerCase()}` : "";
    const bonus = atk.damage_bonus ? `+${atk.damage_bonus}` : "";
    return {
      toHit: atk.to_hit_mod,
      damage: die ? `${die}${bonus}` : undefined,
      damageType: (atk.damage_type?.name ?? atk.extra_damage_type?.name)?.toLowerCase(),
    };
  }
  // Regex fallback on 2024 statblock text: "Melee Attack Roll: +9, ... 12 (2d6 + 5) Bludgeoning damage."
  const toHitMatch = /Attack Roll:\s*\+(\d+)/.exec(action.desc ?? "");
  const dmgMatch = /\((\d+d\d+(?:\s*[+-]\s*\d+)?)\)\s*(\w+)\s+damage/i.exec(action.desc ?? "");
  return {
    toHit: toHitMatch ? Number(toHitMatch[1]) : undefined,
    damage: dmgMatch ? dmgMatch[1].replace(/\s+/g, "") : undefined,
    damageType: dmgMatch ? dmgMatch[2].toLowerCase() : undefined,
  };
}

function usesFrom(usageLimits) {
  // Open5e usage_limits e.g. { type: "PER_DAY", quantity: 3 } — shape is loose; be defensive.
  if (!usageLimits || typeof usageLimits !== "object") return undefined;
  const qty = usageLimits.quantity ?? usageLimits.uses ?? usageLimits.count;
  return typeof qty === "number" && qty > 0 ? { current: qty, max: qty } : undefined;
}

function transformCreatures(rawCreatures) {
  return rawCreatures
    .map((c) => {
      const abilities = {};
      for (const [long, short] of Object.entries(ABILITY_IDS)) {
        abilities[short] = c.ability_scores?.[long] ?? 10;
      }
      const saves = {};
      for (const [long, short] of Object.entries(ABILITY_IDS)) {
        const stated = c.saving_throws?.[long];
        if (typeof stated === "number") saves[short] = stated;
      }
      const skills = {};
      for (const [name, bonus] of Object.entries(c.skill_bonuses ?? {})) {
        skills[`skill-${name.replace(/_/g, "-")}`] = bonus;
      }
      const groups = { actions: [], bonusActions: [], reactions: [], legendary: [] };
      for (const a of c.actions ?? []) {
        const entry = clean({
          name: a.name,
          description: a.desc,
          ...attackFields(a),
          uses: usesFrom(a.usage_limits),
        });
        if (a.action_type === "LEGENDARY_ACTION") groups.legendary.push(entry);
        else if (a.action_type === "REACTION") groups.reactions.push(entry);
        else if (a.action_type === "BONUS_ACTION") groups.bonusActions.push(entry);
        else groups.actions.push(entry);
      }
      const ri = c.resistances_and_immunities ?? {};
      const cr = c.challenge_rating ?? 0;
      const hitDiceMatch = /^(\d+)d(\d+)/.exec(c.hit_dice ?? "");
      return clean({
        id: stripKey(c.key),
        name: c.name,
        size: c.size?.name,
        type: c.type?.name,
        alignment: c.alignment,
        ac: c.armor_class,
        acNote: c.armor_detail,
        hp: c.hit_points,
        hitDice: c.hit_dice,
        hitDiceCount: hitDiceMatch ? Number(hitDiceMatch[1]) : undefined,
        hitDie: hitDiceMatch ? `d${hitDiceMatch[2]}` : undefined,
        walkSpeed: c.speed_all?.walk ?? 30,
        speedLine: speedLine(c.speed_all),
        abilities,
        initiative: c.initiative_bonus ?? undefined,
        saves,
        skills,
        senses: sensesLine(c),
        languages: c.languages?.as_string,
        cr: crString(cr),
        xp: c.experience_points ?? undefined,
        profBonus: c.proficiency_bonus ?? Math.max(2, Math.ceil(cr / 4) + 1),
        vulnerabilities: splitResistList(ri.damage_vulnerabilities_display, ri.damage_vulnerabilities),
        resistances: splitResistList(ri.damage_resistances_display, ri.damage_resistances),
        immunities: splitResistList(ri.damage_immunities_display, ri.damage_immunities),
        conditionImmunities: splitResistList(ri.condition_immunities_display, ri.condition_immunities),
        traits: (c.traits ?? []).map((t) => ({ name: t.name, description: t.desc })),
        ...groups,
      });
    })
    .sort(byId);
}

// ---------------------------------------------------------------------------

async function main() {
  console.log("Fetching 5e-bits files (pinned " + BITS_SHA.slice(0, 10) + ")...");
  const [rawClasses, rawSubclasses, rawProfs, rawSpecies, rawSubspecies, rawTraits, rawFeats, rawEquipment, rawMagicItems] =
    await Promise.all([
      fetchBits("Classes"),
      fetchBits("Subclasses"),
      fetchBits("Proficiencies"),
      fetchBits("Species"),
      fetchBits("Subspecies"),
      fetchBits("Traits"),
      fetchBits("Feats"),
      fetchBits("Equipment"),
      fetchBits("Magic-Items"),
    ]);
  console.log("Fetching Open5e spells + creatures (document " + OPEN5E_DOC + ")...");
  const [rawSpells, rawCreatures] = await Promise.all([fetchOpen5e("spells"), fetchOpen5e("creatures")]);

  const classifier = buildProfClassifier(rawProfs);
  const out = {
    classes: transformClasses(rawClasses, rawSubclasses, classifier),
    subclasses: transformSubclasses(rawSubclasses),
    species: transformSpecies(rawSpecies, rawSubspecies, rawTraits),
    feats: transformFeats(rawFeats),
    equipment: transformEquipment(rawEquipment),
    "magic-items": transformMagicItems(rawMagicItems),
    spells: transformSpells(rawSpells),
    monsters: transformCreatures(rawCreatures),
  };

  // --- validation -----------------------------------------------------------
  assert(out.classes.length === 12, `expected 12 classes, got ${out.classes.length}`);
  assert(out.subclasses.length === 12, `expected 12 subclasses, got ${out.subclasses.length}`);
  assert(out.species.length === 9, `expected 9 species, got ${out.species.length}`);
  assert(out.feats.length === 17, `expected 17 feats, got ${out.feats.length}`);
  assert(out.equipment.length === 182, `expected 182 equipment, got ${out.equipment.length}`);
  assert(out["magic-items"].length === 262, `expected 262 magic items, got ${out["magic-items"].length}`);
  assert(out.spells.length === 339, `expected 339 spells, got ${out.spells.length}`);
  assert(out.monsters.length === 331, `expected 331 monsters, got ${out.monsters.length}`);
  for (const [category, rows] of Object.entries(out)) {
    const seen = new Set();
    for (const row of rows) {
      assert(row.id && row.name, `${category}: entry missing id/name: ${JSON.stringify(row).slice(0, 120)}`);
      assert(!seen.has(row.id), `${category}: duplicate id ${row.id}`);
      seen.add(row.id);
    }
  }
  for (const cls of out.classes) {
    assert(cls.hitDie >= 6 && cls.hitDie <= 12, `class ${cls.id}: odd hit die ${cls.hitDie}`);
    assert(cls.saves.length === 2, `class ${cls.id}: expected 2 saves`);
    assert(cls.multiclass?.prereqs?.length, `class ${cls.id}: missing multiclass prereqs`);
  }
  for (const sp of out.spells) {
    assert(sp.level >= 0 && sp.level <= 9, `spell ${sp.id}: bad level`);
    assert(sp.description, `spell ${sp.id}: missing description`);
  }
  for (const m of out.monsters) {
    assert(typeof m.hp === "number" && typeof m.ac === "number", `monster ${m.id}: missing hp/ac`);
  }

  // --- write ----------------------------------------------------------------
  await mkdir(OUT_DIR, { recursive: true });
  const counts = {};
  for (const [category, rows] of Object.entries(out)) {
    counts[category] = rows.length;
    await writeFile(path.join(OUT_DIR, `${category}.json`), JSON.stringify(rows, null, 1) + "\n");
  }
  const meta = {
    ruleset: "D&D 5e 2024 (SRD 5.2.1)",
    license: "CC-BY-4.0",
    attribution: ATTRIBUTION,
    sources: {
      "5e-bits/5e-database": { commit: BITS_SHA, categories: ["classes", "subclasses", "species", "feats", "equipment", "magic-items"] },
      "open5e-api-v2": { document: OPEN5E_DOC, categories: ["spells", "monsters"] },
    },
    counts,
    generated: new Date().toISOString().slice(0, 10),
  };
  await writeFile(path.join(OUT_DIR, "meta.json"), JSON.stringify(meta, null, 1) + "\n");

  // --- summary for eyeballing ----------------------------------------------
  console.log("Wrote", OUT_DIR);
  console.table(counts);
  const distinct = (rows, f) => [...new Set(rows.map(f))].sort();
  console.log("casting times:", distinct(out.spells, (s) => s.time).join(" | "));
  console.log("spell ranges (sample):", distinct(out.spells, (s) => s.range).slice(0, 12).join(" | "));
  const noAtk = out.monsters.filter((m) => (m.actions ?? []).length && !(m.actions ?? []).some((a) => a.toHit != null));
  console.log(`monsters with actions but no parsed to-hit: ${noAtk.length}`, noAtk.slice(0, 8).map((m) => m.id).join(", "));
  const biggest = [...out.monsters].sort((a, b) => JSON.stringify(b).length - JSON.stringify(a).length)[0];
  console.log("largest monster entry:", biggest.id, JSON.stringify(biggest).length, "bytes");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
