// Builds public/compendium/*.json — the read-only D&D 2024 dataset the in-app
// pickers search. Parsed from the local "Official Only 2024.xml" (Fight Club 5
// compendium XML v5 carrying the full 2024 PHB/DMG/MM). Regenerate after
// swapping the XML:  npm run compendium
//
// The committed JSON output is what the app serves (statically, lazy-fetched
// per category). Content © Wizards of the Coast — private-table use only.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const XML_FILE = "Official Only 2024.xml";
const OUT_DIR = path.join(ROOT, "public", "compendium");

const assert = (cond, msg) => {
  if (!cond) throw new Error(`Validation failed: ${msg}`);
};
const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const clean = (obj) => {
  // Drop undefined/null/empty-array/empty-string fields for lean, stable output.
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0)) delete obj[k];
  }
  return obj;
};

// ---------------------------------------------------------------------------
// Minimal XML parser — the compendium file is regular machine-generated XML:
// no CDATA, no comments, no entities beyond the standard five (verified).
// ---------------------------------------------------------------------------

function decodeEntities(s) {
  if (!s.includes("&")) return s;
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-z]+);/g, (whole, code) => {
    if (code[0] === "#") {
      const n = code[1] === "x" || code[1] === "X" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return String.fromCodePoint(n);
    }
    const named = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" }[code];
    assert(named !== undefined, `unknown entity &${code};`);
    return named;
  });
}

function parseXml(src) {
  const root = { tag: "#root", attrs: {}, children: [], text: "" };
  const stack = [root];
  let i = 0;
  while (i < src.length) {
    const lt = src.indexOf("<", i);
    if (lt < 0) {
      stack[stack.length - 1].text += decodeEntities(src.slice(i));
      break;
    }
    if (lt > i) stack[stack.length - 1].text += decodeEntities(src.slice(i, lt));
    const gt = src.indexOf(">", lt);
    assert(gt > lt, `unterminated tag at offset ${lt}`);
    let raw = src.slice(lt + 1, gt);
    i = gt + 1;
    if (raw.startsWith("?")) {
      assert(stack.length === 1 && root.children.length === 0, "processing instruction past prolog");
      continue;
    }
    assert(!raw.startsWith("!"), `unexpected <! markup at offset ${lt}`);
    if (raw.startsWith("/")) {
      const closed = stack.pop();
      assert(closed && closed.tag === raw.slice(1).trim(), `mismatched closing tag </${raw.slice(1)}>`);
      continue;
    }
    const selfClosing = raw.endsWith("/");
    if (selfClosing) raw = raw.slice(0, -1);
    const nameMatch = /^([\w:.-]+)\s*/.exec(raw);
    assert(nameMatch, `bad tag <${raw}>`);
    const el = { tag: nameMatch[1], attrs: {}, children: [], text: "" };
    const attrRe = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
    let am;
    while ((am = attrRe.exec(raw.slice(nameMatch[0].length)))) el.attrs[am[1]] = decodeEntities(am[2] ?? am[3]);
    stack[stack.length - 1].children.push(el);
    if (!selfClosing) stack.push(el);
  }
  assert(stack.length === 1, `unclosed <${stack[stack.length - 1].tag}> at EOF`);
  return root;
}

const kids = (el, tag) => el.children.filter((c) => c.tag === tag);
const kid = (el, tag) => el.children.find((c) => c.tag === tag);
const text1 = (el, tag) => (kid(el, tag)?.text ?? "").trim();
const texts = (el, tag) => kids(el, tag).map((c) => c.text);
const intOf = (el, tag) => {
  const t = text1(el, tag);
  return t === "" ? undefined : Number.parseInt(t, 10);
};
const floatOf = (el, tag) => {
  const t = text1(el, tag);
  return t === "" ? undefined : Number.parseFloat(t);
};

// ---------------------------------------------------------------------------
// Shared text helpers
// ---------------------------------------------------------------------------

const stripYear = (s) => s.replace(/\s*\[2024\]\s*$/, "").trim();
const kebab = (s) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
const capFirst = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const titleWords = (s) =>
  s
    .split(/\s+/)
    .map((w) => capFirst(w))
    .join(" ");

const SMALL_WORDS = new Set(["of", "the", "and", "a", "an", "in", "to", "or", "for", "with"]);
/** "Path Of The Wild Heart" -> "Path of the Wild Heart" (file TitleCases everything). */
const titleFix = (s) =>
  s
    .split(" ")
    .map((w, i) => (i > 0 && SMALL_WORDS.has(w.toLowerCase()) ? w.toLowerCase() : w))
    .join(" ");

/**
 * Join a tag's <text> nodes into paragraphed prose. Empty <text/> nodes are
 * paragraph breaks, leading tabs are indentation only, and the trailing
 * "Source: …" line is captured separately.
 */
function joinTexts(rawLines) {
  let source;
  const lines = [];
  for (const raw of rawLines) {
    const line = raw.replace(/^\t+/, "").replace(/\s+$/, "");
    const sm = /^Source:\s*(.+)$/.exec(line);
    if (sm) {
      source = source ?? sm[1].trim();
      continue;
    }
    if (line === "" && (lines.length === 0 || lines[lines.length - 1] === "")) continue;
    lines.push(line);
  }
  while (lines.length && lines[lines.length - 1] === "") lines.pop();
  return { text: lines.join("\n"), source };
}

const ABILITY_IDS = { strength: "str", dexterity: "dex", constitution: "con", intelligence: "int", wisdom: "wis", charisma: "cha" };
const ABILITY_SHORT = new Set(Object.values(ABILITY_IDS));
function abilityId(word) {
  const id = ABILITY_IDS[word.trim().toLowerCase()];
  assert(id, `unknown ability "${word}"`);
  return id;
}

// The 18 skill ids from DEFAULT_SHEET_TEMPLATE (src/lib/types.ts) — everything
// we emit must land on one of these or the sheet mappers silently drop it.
const SKILL_IDS = new Set([
  "skill-acrobatics", "skill-animal-handling", "skill-arcana", "skill-athletics", "skill-deception",
  "skill-history", "skill-insight", "skill-intimidation", "skill-investigation", "skill-medicine",
  "skill-nature", "skill-perception", "skill-performance", "skill-persuasion", "skill-religion",
  "skill-sleight-of-hand", "skill-stealth", "skill-survival",
]);
function skillId(name) {
  const id = `skill-${kebab(name)}`;
  assert(SKILL_IDS.has(id), `unknown skill "${name}"`);
  return id;
}

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

// PHB 2024 multiclassing table — the XML carries no structured prerequisites.
const MULTICLASS_PREREQS = {
  barbarian: [{ abilityIds: ["str"], min: 13, mode: "and" }],
  bard: [{ abilityIds: ["cha"], min: 13, mode: "and" }],
  cleric: [{ abilityIds: ["wis"], min: 13, mode: "and" }],
  druid: [{ abilityIds: ["wis"], min: 13, mode: "and" }],
  fighter: [{ abilityIds: ["str", "dex"], min: 13, mode: "or" }],
  monk: [
    { abilityIds: ["dex"], min: 13, mode: "and" },
    { abilityIds: ["wis"], min: 13, mode: "and" },
  ],
  paladin: [
    { abilityIds: ["str"], min: 13, mode: "and" },
    { abilityIds: ["cha"], min: 13, mode: "and" },
  ],
  ranger: [
    { abilityIds: ["dex"], min: 13, mode: "and" },
    { abilityIds: ["wis"], min: 13, mode: "and" },
  ],
  rogue: [{ abilityIds: ["dex"], min: 13, mode: "and" }],
  sorcerer: [{ abilityIds: ["cha"], min: 13, mode: "and" }],
  warlock: [{ abilityIds: ["cha"], min: 13, mode: "and" }],
  wizard: [{ abilityIds: ["int"], min: 13, mode: "and" }],
};

/** "Light and Medium armor and Shields" -> ["Light Armor", "Medium Armor", "Shields"] */
function parseArmorList(value) {
  const out = [];
  for (const raw of value.replace(/\./g, "").split(/,|\band\b/)) {
    const t = raw.trim().toLowerCase();
    if (!t) continue;
    if (t === "shield" || t === "shields") out.push("Shields");
    else if (/^(light|medium|heavy)$/.test(t)) out.push(titleWords(`${t} armor`));
    else out.push(titleWords(t.endsWith("armor") ? t : `${t} armor`));
  }
  return out;
}

/** "Simple and Martial weapons" -> ["Simple Weapons", "Martial Weapons"] */
function parseWeaponList(value) {
  const out = [];
  for (const raw of value.replace(/\./g, "").split(/,|\band\b/)) {
    const t = raw.trim().toLowerCase();
    if (!t) continue;
    if (/^(simple|martial)$/.test(t)) out.push(titleWords(`${t} weapons`));
    else out.push(titleWords(t));
  }
  return out;
}

function parseCsvProfs(value, mapper) {
  const v = value.trim();
  if (!v || v.toLowerCase() === "none") return [];
  return v.split(",").map((t) => mapper(t.trim())).filter(Boolean);
}

function transformClasses(rawClasses) {
  const classes = [];
  const subclasses = [];
  for (const el of rawClasses) {
    const name = stripYear(text1(el, "name"));
    const id = kebab(name);
    // Split on "." too — the file has one OCR typo ("Intimidation. Persuasion").
    const profEntries = text1(el, "proficiency").split(/[,.]/).map((t) => t.trim()).filter(Boolean);
    assert(profEntries.length >= 2, `class ${id}: proficiency list too short`);
    const saves = profEntries.slice(0, 2).map(abilityId);
    const skillList = profEntries.slice(2).map(skillId);
    const numSkills = intOf(el, "numSkills") ?? 2;
    const spellAbility = text1(el, "spellAbility");

    const subByName = new Map(); // lowercased subclass name -> record
    let primaryAbility;
    const multiclass = { prereqs: MULTICLASS_PREREQS[id] };
    assert(multiclass.prereqs, `class ${id}: missing hardcoded multiclass prereqs`);

    // Pass 1: collect subclass intros so feature routing can match by name.
    for (const auto of kids(el, "autolevel")) {
      for (const feature of kids(auto, "feature")) {
        if (feature.attrs.optional !== "YES") continue;
        const fname = text1(feature, "name");
        const intro = new RegExp(`^${name} Subclass:\\s*(.+)$`, "i").exec(fname);
        if (!intro) continue;
        const subName = titleFix(intro[1].trim());
        const rec = {
          id: kebab(subName),
          name: subName,
          classId: id,
          intro: joinTexts(texts(feature, "text")).text,
          features: [],
        };
        assert(!subByName.has(subName.toLowerCase()), `class ${id}: duplicate subclass ${subName}`);
        subByName.set(subName.toLowerCase(), rec);
      }
    }

    // Pass 2: route features.
    for (const auto of kids(el, "autolevel")) {
      const level = Number(auto.attrs.level ?? 0);
      for (const feature of kids(auto, "feature")) {
        const fname = text1(feature, "name");
        const optional = feature.attrs.optional === "YES";
        const { text } = joinTexts(texts(feature, "text"));
        if (!optional) continue; // base class features are not part of the compendium schema
        if (new RegExp(`^${name} Subclass:`, "i").test(fname)) continue; // handled in pass 1
        const subFeature = /^Level (\d+):\s*(.+?)\s*\(([^()]+)\)$/.exec(fname);
        if (subFeature && subByName.has(subFeature[3].trim().toLowerCase())) {
          subByName.get(subFeature[3].trim().toLowerCase()).features.push({
            level: Number(subFeature[1]),
            name: titleFix(subFeature[2]),
            text,
          });
          continue;
        }
        if (/Multiclass Character$/i.test(fname)) {
          for (const line of text.split("\n")) {
            const kv = /^([^:]+):\s*(.+)$/.exec(line.trim());
            if (!kv) continue;
            const [, key, value] = kv;
            if (/^Armor Training$/i.test(key)) multiclass.armorProfs = parseArmorList(value);
            else if (/^Weapon Proficienc/i.test(key)) multiclass.weaponProfs = parseWeaponList(value);
            else if (/^Tool Proficienc/i.test(key)) {
              multiclass.toolProfs = [capFirst(value.replace(/^proficiency with\s*/i, "").trim())];
            } else if (/^Skill Proficienc/i.test(key)) {
              const choose = /^Choose (\d+):\s*(.+)$/i.exec(value);
              if (choose) {
                multiclass.skillChoice = {
                  choose: Number(choose[1]),
                  from: choose[2].split(/,|\bor\b/).map((s) => s.trim()).filter(Boolean).map(skillId),
                };
              } else {
                // "proficiency in one skill of your choice" (bard) — any skill.
                multiclass.skillChoice = { choose: 1, from: [...SKILL_IDS].sort() };
              }
            }
          }
          continue;
        }
        if (/Level 1 Character$/i.test(fname)) {
          const pa = /^Primary Ability:\s*(.+)$/m.exec(text);
          if (pa) primaryAbility = pa[1].trim();
          continue;
        }
        // Anything else optional (none observed) is ignored.
      }
    }

    const subs = [...subByName.values()];
    assert(subs.length > 0, `class ${id}: no subclasses parsed`);
    const featureLevels = subs.flatMap((s) => s.features.map((f) => f.level));
    for (const sub of subs) {
      sub.features.sort((a, b) => a.level - b.level);
      subclasses.push(
        clean({
          id: sub.id,
          name: sub.name,
          classId: sub.classId,
          description: [sub.intro, ...sub.features.map((f) => `Level ${f.level} — ${f.name}. ${f.text}`)]
            .filter(Boolean)
            .join("\n\n"),
        }),
      );
    }

    classes.push(
      clean({
        id,
        name,
        hitDie: intOf(el, "hd"),
        primaryAbility,
        saves,
        armorProfs: parseCsvProfs(text1(el, "armor"), (t) => titleWords(t)),
        weaponProfs: parseCsvProfs(text1(el, "weapons"), (t) => titleWords(t)),
        toolProfs: parseCsvProfs(text1(el, "tools"), (t) => capFirst(t)),
        skillChoices: skillList.length ? { choose: numSkills, from: skillList } : undefined,
        spellcasting: CASTER_TYPES[id]
          ? { abilityId: abilityId(spellAbility), casterType: CASTER_TYPES[id] }
          : undefined,
        subclassIds: subs.map((s) => s.id),
        subclassLevel: featureLevels.length ? Math.min(...featureLevels) : 3,
        multiclass: clean(multiclass),
      }),
    );
  }
  return { classes: classes.sort(byId), subclasses: subclasses.sort(byId) };
}

// ---------------------------------------------------------------------------
// Species (races merged into species + lineage subspecies)
// ---------------------------------------------------------------------------

const SIZE_WORDS = { T: "Tiny", S: "Small", M: "Medium", L: "Large", H: "Huge", G: "Gargantuan" };

function parseRace(el) {
  const fullName = stripYear(text1(el, "name"));
  const [baseName, variantName] = fullName.split(/,\s*/);
  let creatureType;
  const traits = [];
  for (const traitEl of kids(el, "trait")) {
    const tname = text1(traitEl, "name");
    const { text } = joinTexts(texts(traitEl, "text"));
    if (tname === "Creature Type") {
      creatureType = text.split("\n")[0].trim();
      continue;
    }
    if (tname === "Size") continue; // carried by the size field
    traits.push({ name: tname, description: text });
  }
  return {
    baseName,
    variantName,
    size: SIZE_WORDS[text1(el, "size")] ?? "Medium",
    speed: intOf(el, "speed") ?? 30,
    creatureType,
    traits,
  };
}

function transformSpecies(rawRaces) {
  const groups = new Map();
  for (const el of rawRaces) {
    const race = parseRace(el);
    if (!groups.has(race.baseName)) groups.set(race.baseName, []);
    groups.get(race.baseName).push(race);
  }
  const species = [];
  for (const [baseName, variants] of groups) {
    const base = variants[0];
    if (variants.length === 1) {
      species.push(
        clean({
          id: kebab(baseName),
          name: baseName,
          creatureType: base.creatureType,
          size: base.size,
          speed: base.speed,
          traits: base.traits,
        }),
      );
      continue;
    }
    // Shared traits (identical name+text in every variant) belong to the species;
    // the rest (e.g. Drow's 120 ft. Darkvision, each "X Lineage") go to the lineage.
    // "Description" gets paragraph-level treatment: common leading paragraphs are
    // species lore, variant-specific tails become lineage descriptions.
    const key = (t) => `${t.name} ${t.description}`;
    const inAll = (t) => variants.every((v) => v.traits.some((vt) => key(vt) === key(t)));
    const sharedTraits = [];
    let commonDescParas;
    for (const t of base.traits) {
      if (t.name === "Description") {
        const paraLists = variants.map((v) => (v.traits.find((vt) => vt.name === "Description")?.description ?? "").split("\n\n"));
        let n = 0;
        while (paraLists.every((p) => p.length > n && p[0 + n] === paraLists[0][n])) n++;
        commonDescParas = n;
        if (n > 0) sharedTraits.push({ name: "Description", description: paraLists[0].slice(0, n).join("\n\n") });
        continue;
      }
      if (inAll(t)) sharedTraits.push(t);
    }
    const subspecies = variants
      .map((v) => {
        const lineageTraits = [];
        for (const t of v.traits) {
          if (t.name === "Description") {
            const rest = t.description.split("\n\n").slice(commonDescParas ?? 0).join("\n\n");
            if (rest) lineageTraits.push({ name: "Description", description: rest });
            continue;
          }
          if (!sharedTraits.some((st) => key(st) === key(t))) lineageTraits.push(t);
        }
        return clean({ id: kebab(`${baseName} ${v.variantName}`), name: v.variantName, traits: lineageTraits });
      })
      .sort(byId);
    species.push(
      clean({
        id: kebab(baseName),
        name: baseName,
        creatureType: base.creatureType,
        size: base.size,
        speed: base.speed,
        traits: sharedTraits,
        subspecies,
      }),
    );
  }
  return species.sort(byId);
}

// ---------------------------------------------------------------------------
// Backgrounds
// ---------------------------------------------------------------------------

function transformBackgrounds(rawBackgrounds) {
  return rawBackgrounds
    .map((el) => {
      const name = stripYear(text1(el, "name"));
      const description = kids(el, "trait")
        .filter((t) => text1(t, "name") === "Description")
        .map((t) => joinTexts(texts(t, "text")).text)
        .join("\n\n");
      return clean({
        id: kebab(name),
        name,
        skills: text1(el, "proficiency").split(",").map((s) => skillId(s.trim())),
        description,
      });
    })
    .sort(byId);
}

// ---------------------------------------------------------------------------
// Feats (plus Maneuver/Metamagic/Invocation pseudo-spells folded in)
// ---------------------------------------------------------------------------

function featCategory(rawName) {
  if (rawName.startsWith("Origin: ")) return { name: rawName.slice(8), category: "origin" };
  if (rawName.startsWith("Fighting Style: ")) return { name: rawName.slice(16), category: "fighting-style" };
  if (/^Boon of\b/i.test(rawName)) return { name: rawName, category: "epic-boon" };
  return { name: rawName, category: "general" };
}

function transformFeats(rawFeats, pseudoFeats) {
  const rows = rawFeats.map((el) => {
    const { name, category } = featCategory(stripYear(text1(el, "name")));
    const prereq = text1(el, "prerequisite");
    const { text } = joinTexts(texts(el, "text"));
    return clean({
      id: kebab(name),
      name,
      category,
      description: [prereq ? `Prerequisite: ${prereq}` : "", text].filter(Boolean).join("\n\n"),
    });
  });
  return rows.concat(pseudoFeats).sort(byId);
}

// ---------------------------------------------------------------------------
// Spells
// ---------------------------------------------------------------------------

const SCHOOLS = {
  A: "Abjuration",
  C: "Conjuration",
  D: "Divination",
  EN: "Enchantment",
  EV: "Evocation",
  I: "Illusion",
  N: "Necromancy",
  T: "Transmutation",
};

const PSEUDO_SPELL_PREFIXES = { Maneuver: "maneuver", Metamagic: "metamagic", Invocation: "invocation" };

function normalizeSpellTime(raw) {
  // The file doubles the prefix once ("Bonus Action, Bonus Action, which…").
  const t = raw.trim().replace(/^Bonus Action,\s*Bonus Action,/i, "Bonus Action,");
  const clause = /^(Action|Bonus Action|1 reaction|Reaction)(?:,\s*(.+))?$/is.exec(t);
  if (clause) {
    const base = clause[1].toLowerCase();
    return {
      time: base === "action" ? "1 action" : base === "bonus action" ? "1 bonus action" : "1 reaction",
      trigger: clause[2]?.trim(),
    };
  }
  const timed = /^(\d+)\s*(minute|hour)s?$/i.exec(t);
  if (timed) return { time: `${timed[1]} ${timed[2].toLowerCase()}${Number(timed[1]) > 1 ? "s" : ""}` };
  return { time: t };
}

function transformSpells(rawSpells) {
  const spells = [];
  const pseudoFeats = [];
  for (const el of rawSpells) {
    const rawName = stripYear(text1(el, "name"));
    const pseudo = /^([A-Za-z]+):\s*(.+)$/.exec(rawName);
    const { text } = joinTexts(texts(el, "text"));
    if (pseudo && PSEUDO_SPELL_PREFIXES[pseudo[1]]) {
      // Battle Master maneuvers, Sorcerer metamagic, Warlock invocations ride
      // along as feat-picker entries — they're pickable character options, not spells.
      pseudoFeats.push(clean({ id: kebab(pseudo[2]), name: pseudo[2], category: PSEUDO_SPELL_PREFIXES[pseudo[1]], description: text }));
      continue;
    }
    const school = SCHOOLS[text1(el, "school")];
    assert(school, `spell ${rawName}: unknown school "${text1(el, "school")}"`);
    const duration = text1(el, "duration");
    const { time, trigger } = normalizeSpellTime(text1(el, "time"));
    const classes = text1(el, "classes")
      .split(",")
      .map((c) => c.trim())
      .filter((c) => /^[A-Za-z]+ \[2024\]$/.test(c))
      .map((c) => kebab(stripYear(c)));
    const rollMatch = /(\d+d\d+(?:\s*\+\s*\d+)?)\s+[A-Za-z]+\s+damage/i.exec(text);
    spells.push(
      clean({
        id: kebab(rawName),
        name: rawName,
        level: intOf(el, "level") ?? 0,
        school,
        time,
        range: text1(el, "range"),
        components: text1(el, "components"),
        duration,
        concentration: /^Concentration/i.test(duration) || undefined,
        ritual: text1(el, "ritual") === "YES" || undefined,
        classes,
        roll: rollMatch ? rollMatch[1].replace(/\s+/g, "") : undefined,
        description: [text, trigger ? `Trigger: ${capFirst(trigger)}` : ""].filter(Boolean).join("\n\n"),
      }),
    );
  }
  return { spells: spells.sort(byId), pseudoFeats };
}

// ---------------------------------------------------------------------------
// Items → equipment + magic items
// ---------------------------------------------------------------------------

const DMG_TYPES = { B: "bludgeoning", P: "piercing", S: "slashing", R: "radiant", N: "necrotic", Y: "psychic" };
const WEAPON_PROPS = {
  A: "Ammunition",
  F: "Finesse",
  H: "Heavy",
  L: "Light",
  LD: "Loading",
  M: "Martial",
  R: "Reach",
  S: "Special",
  T: "Thrown",
  "2H": "Two-Handed",
  V: "Versatile",
};
const EQUIP_CATEGORY = {
  M: "Melee Weapons",
  R: "Ranged Weapons",
  A: "Ammunition",
  LA: "Light Armor",
  MA: "Medium Armor",
  HA: "Heavy Armor",
  S: "Shields",
  G: "Adventuring Gear",
  P: "Potions",
  SC: "Scrolls",
  W: "Wondrous Items",
  RD: "Rods",
  ST: "Staffs",
  WD: "Wands",
  RG: "Rings",
  $: "Treasure",
};
const ARMOR_CODES = new Set(["LA", "MA", "HA", "S"]);

function costString(value) {
  if (value == null || Number.isNaN(value)) return undefined;
  const cp = Math.round(value * 100);
  if (cp % 100 === 0) return `${cp / 100} gp`;
  if (cp % 10 === 0) return `${cp / 10} sp`;
  return `${cp} cp`;
}

function equipmentItemType(code, name) {
  if (code === "M" || code === "R") return "weapon";
  if (ARMOR_CODES.has(code)) return "armor";
  if (code === "$") return "treasure";
  if (code === "G" && /tool|kit|instrument|supplies|gaming set/i.test(name)) return "tool";
  return "gear";
}

function magicItemType(code) {
  if (code === "M" || code === "R") return "weapon";
  if (ARMOR_CODES.has(code)) return "armor";
  if (code === "P" || code === "SC") return "consumable";
  return "wondrous";
}

function magicRarity(detail) {
  const m = /^(common|uncommon|rare|very rare|legendary|artifact|varies)\b/i.exec(detail);
  return m ? m[1].toLowerCase().replace(" ", "-") : "varies";
}

/** Pull "Sap (Mastery). …" paragraphs out of the text → "Mastery: Sap" property. */
function extractMastery(text) {
  const paragraphs = text.split("\n\n");
  const kept = [];
  const masteries = [];
  for (const p of paragraphs) {
    const m = /^([A-Za-z' -]+?)\s*\(Mastery\)[.:]/.exec(p);
    if (m) masteries.push(`Mastery: ${m[1].trim()}`);
    else kept.push(p);
  }
  return { text: kept.join("\n\n"), masteries };
}

function transformItems(rawItems) {
  const equipment = [];
  const magicItems = [];
  const seen = new Map();
  for (const el of rawItems) {
    const name = stripYear(text1(el, "name"));
    const id = kebab(name);
    const code = text1(el, "type");
    assert(EQUIP_CATEGORY[code], `item ${id}: unknown type code "${code}"`);
    const isMagic = text1(el, "magic") === "1";
    if (seen.has(id)) {
      // The file doubles a few magic items verbatim (PHB + DMG printings).
      assert(seen.get(id) === code, `item ${id}: duplicate with different type`);
      continue;
    }
    seen.set(id, code);
    const { text } = joinTexts(texts(el, "text"));
    const detail = text1(el, "detail");
    const dmg1 = text1(el, "dmg1");
    const dmg2 = text1(el, "dmg2");
    const dmgTypeCode = text1(el, "dmgType");
    if (dmgTypeCode) assert(DMG_TYPES[dmgTypeCode], `item ${id}: unknown damage type "${dmgTypeCode}"`);
    const weight = floatOf(el, "weight");
    const cost = costString(floatOf(el, "value"));

    if (isMagic) {
      const rarity = magicRarity(detail);
      const attuneQualifier = /requires attunement (by [^)]+)/i.exec(detail);
      magicItems.push(
        clean({
          id,
          name,
          itemType: magicItemType(code),
          category: EQUIP_CATEGORY[code],
          rarity,
          rarityText: rarity === "varies" ? capFirst(detail) : undefined,
          attunement: /requires attunement/i.test(detail) || undefined,
          description: [attuneQualifier ? `Requires attunement ${attuneQualifier[1]}.` : "", text]
            .filter(Boolean)
            .join("\n\n"),
        }),
      );
      continue;
    }

    const { text: strippedText, masteries } = extractMastery(text);
    const properties = text1(el, "property")
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean)
      .map((p) => {
        assert(WEAPON_PROPS[p], `item ${id}: unknown property code "${p}"`);
        return WEAPON_PROPS[p] === "Versatile" && dmg2 ? `Versatile (${dmg2})` : WEAPON_PROPS[p];
      });
    const rangeText = text1(el, "range");
    if (rangeText) properties.push(`Range ${rangeText}`);
    properties.push(...masteries);
    const ac = intOf(el, "ac");
    equipment.push(
      clean({
        id,
        name,
        category: EQUIP_CATEGORY[code],
        itemType: equipmentItemType(code, name),
        cost,
        weight,
        damage: dmg1 || undefined,
        damageType: dmgTypeCode ? DMG_TYPES[dmgTypeCode] : undefined,
        range: code === "M" ? "melee" : code === "R" ? "ranged" : undefined,
        properties,
        acBase: ARMOR_CODES.has(code) ? ac : undefined,
        acDexBonus: code === "LA" || code === "MA" || undefined,
        acMaxBonus: code === "MA" ? 2 : undefined,
        strMin: intOf(el, "strength") || undefined,
        stealthDisadvantage: text1(el, "stealth") === "1" || undefined,
        description: strippedText,
      }),
    );
  }
  return { equipment: equipment.sort(byId), magicItems: magicItems.sort(byId) };
}

// ---------------------------------------------------------------------------
// Monsters
// ---------------------------------------------------------------------------

const XP_BY_CR = {
  0: 10, "1/8": 25, "1/4": 50, "1/2": 100, 1: 200, 2: 450, 3: 700, 4: 1100, 5: 1800,
  6: 2300, 7: 2900, 8: 3900, 9: 5000, 10: 5900, 11: 7200, 12: 8400, 13: 10000, 14: 11500,
  15: 13000, 16: 15000, 17: 18000, 18: 20000, 19: 22000, 20: 25000, 21: 33000, 22: 41000,
  23: 50000, 24: 62000, 25: 75000, 26: 90000, 27: 105000, 28: 120000, 29: 135000, 30: 155000,
};

const crToNumber = (cr) => (cr.includes("/") ? Number(cr.split("/")[0]) / Number(cr.split("/")[1]) : Number(cr));

function parseSignedPairs(value, keyMapper) {
  const out = {};
  for (const part of value.split(",")) {
    const m = /^(.+?)\s*([+-]\d+)$/.exec(part.trim());
    if (!m) continue;
    const key = keyMapper(m[1].trim());
    if (key) out[key] = Number(m[2]);
  }
  return out;
}

const splitList = (value) =>
  value
    .split(/[;,]/)
    .map((s) => capFirst(s.trim()))
    .filter(Boolean);

function monsterActionEntry(el) {
  let name = text1(el, "name");
  const { text } = joinTexts(texts(el, "text"));
  let isBonus = false;
  const bonusMatch = /^(.*?)\s*\(bonus action\)\s*$/i.exec(name);
  if (bonusMatch) {
    name = bonusMatch[1];
    isBonus = true;
  }
  const usesMatch = /\((\d+)\/day\b[^)]*\)/i.exec(name);
  let toHit;
  let damage;
  const attack = kid(el, "attack")?.text;
  if (attack) {
    const parts = attack.split("|");
    if (parts[1] && /^[+-]?\d+$/.test(parts[1].trim())) toHit = Number(parts[1].trim());
    const dm = /^(\d*d\d+(?:[+-]\d+)?)/.exec((parts[2] ?? "").replace(/\s+/g, ""));
    if (dm) damage = dm[1];
  }
  if (toHit === undefined) {
    const m = /Attack Roll:\s*\+(\d+)/.exec(text);
    if (m) toHit = Number(m[1]);
  }
  if (!damage) {
    const m = /\((\d+d\d+(?:\s*[+-]\s*\d+)?)\)/.exec(text);
    if (m) damage = m[1].replace(/\s+/g, "");
  }
  const typeMatch = /\)\s*([A-Za-z]+)\s+damage/.exec(text) ?? /\b([A-Za-z]+)\s+damage\b/.exec(text);
  return {
    entry: clean({
      name,
      description: text,
      toHit,
      damage,
      damageType: damage && typeMatch ? typeMatch[1].toLowerCase() : undefined,
      uses: usesMatch ? { current: Number(usesMatch[1]), max: Number(usesMatch[1]) } : undefined,
    }),
    isBonus,
  };
}

function transformMonsters(rawMonsters) {
  return rawMonsters
    .map((el) => {
      const name = stripYear(text1(el, "name"));
      const acMatch = /^(\d+)(?:\s*\((.+)\))?$/.exec(text1(el, "ac"));
      assert(acMatch, `monster ${name}: unparseable ac "${text1(el, "ac")}"`);
      const hpMatch = /^(\d+)(?:\s*\((.+)\))?$/.exec(text1(el, "hp"));
      assert(hpMatch, `monster ${name}: unparseable hp "${text1(el, "hp")}"`);
      const hitDice = hpMatch[2];
      const hitDiceMatch = /(\d+)d(\d+)/.exec(hitDice ?? "");
      const speedLine = text1(el, "speed");
      const cr = text1(el, "cr");
      const abilities = {};
      for (const short of ABILITY_SHORT) abilities[short] = intOf(el, short) ?? 10;

      let source;
      const traits = [];
      for (const traitEl of kids(el, "trait")) {
        const tname = text1(traitEl, "name");
        const { text } = joinTexts(texts(traitEl, "text"));
        if (tname === "Source") {
          source = source ?? text.split("\n")[0];
          continue;
        }
        if (tname === "Proficiency Bonus" && /^(equals your Proficiency Bonus|\+\d+)$/i.test(text)) continue;
        const usesMatch = /\((\d+)\/day\b[^)]*\)/i.exec(tname);
        traits.push(
          clean({
            name: tname,
            description: text,
            uses: usesMatch ? { current: Number(usesMatch[1]), max: Number(usesMatch[1]) } : undefined,
          }),
        );
      }

      const groups = { actions: [], bonusActions: [], reactions: [], legendary: [] };
      for (const a of kids(el, "action")) {
        const { entry, isBonus } = monsterActionEntry(a);
        (isBonus ? groups.bonusActions : groups.actions).push(entry);
      }
      for (const r of kids(el, "reaction")) groups.reactions.push(monsterActionEntry(r).entry);
      for (const l of kids(el, "legendary")) groups.legendary.push(monsterActionEntry(l).entry);

      const senses = [text1(el, "senses"), intOf(el, "passive") != null ? `Passive Perception ${intOf(el, "passive")}` : ""]
        .filter(Boolean)
        .join(", ");
      return clean({
        id: kebab(name),
        name,
        size: SIZE_WORDS[text1(el, "size")] ?? text1(el, "size"),
        type: capFirst(text1(el, "type").replace(/\s*\(.*\)$/, "").trim()),
        alignment: titleWords(text1(el, "alignment")),
        ac: Number(acMatch[1]),
        acNote: acMatch[2],
        hp: Number(hpMatch[1]),
        hitDice,
        hitDiceCount: hitDiceMatch ? Number(hitDiceMatch[1]) : undefined,
        hitDie: hitDiceMatch ? `d${hitDiceMatch[2]}` : undefined,
        walkSpeed: Number(/^(\d+)/.exec(speedLine)?.[1] ?? 30),
        speedLine,
        abilities,
        initiative: intOf(el, "init"),
        saves: parseSignedPairs(text1(el, "save"), (k) => {
          const id = k.toLowerCase();
          assert(ABILITY_SHORT.has(id), `monster ${name}: unknown save "${k}"`);
          return id;
        }),
        skills: parseSignedPairs(text1(el, "skill"), (k) => skillId(k)),
        senses: capFirst(senses),
        languages: text1(el, "languages"),
        cr,
        xp: XP_BY_CR[cr],
        profBonus: Math.max(2, Math.ceil(crToNumber(cr) / 4) + 1),
        vulnerabilities: splitList(text1(el, "vulnerable")),
        resistances: splitList(text1(el, "resist")),
        immunities: splitList(text1(el, "immune")),
        conditionImmunities: splitList(text1(el, "conditionImmune")),
        source,
        traits,
        ...groups,
      });
    })
    .sort(byId);
}

// ---------------------------------------------------------------------------

async function main() {
  const xmlPath = path.join(ROOT, XML_FILE);
  let xml;
  try {
    xml = await readFile(xmlPath, "utf8");
  } catch {
    throw new Error(`Missing "${XML_FILE}" at the repo root — the compendium is generated from that local file.`);
  }
  console.log(`Parsing ${XML_FILE} (${(xml.length / 1024 / 1024).toFixed(1)} MB)...`);
  const root = parseXml(xml);
  const compendium = root.children.find((c) => c.tag === "compendium");
  assert(compendium, "no <compendium> root element");

  const { classes, subclasses } = transformClasses(kids(compendium, "class"));
  const { spells, pseudoFeats } = transformSpells(kids(compendium, "spell"));
  const { equipment, magicItems } = transformItems(kids(compendium, "item"));
  const out = {
    classes,
    subclasses,
    species: transformSpecies(kids(compendium, "race")),
    backgrounds: transformBackgrounds(kids(compendium, "background")),
    feats: transformFeats(kids(compendium, "feat"), pseudoFeats),
    equipment,
    "magic-items": magicItems,
    spells,
    monsters: transformMonsters(kids(compendium, "monster")),
  };

  // --- validation -----------------------------------------------------------
  for (const [category, rows] of Object.entries(out)) {
    const seen = new Set();
    for (const row of rows) {
      assert(row.id && row.name, `${category}: entry missing id/name: ${JSON.stringify(row).slice(0, 120)}`);
      assert(!seen.has(row.id), `${category}: duplicate id ${row.id}`);
      seen.add(row.id);
    }
  }
  assert(out.classes.length === 12, `expected 12 classes, got ${out.classes.length}`);
  assert(out.subclasses.length === 48, `expected 48 subclasses, got ${out.subclasses.length}`);
  assert(out.species.length === 10, `expected 10 species, got ${out.species.length}`);
  assert(out.backgrounds.length === 16, `expected 16 backgrounds, got ${out.backgrounds.length}`);
  assert(out.spells.length === 391, `expected 391 spells, got ${out.spells.length}`);
  assert(out.monsters.length === 520, `expected 520 monsters, got ${out.monsters.length}`);
  for (const cls of out.classes) {
    assert(cls.hitDie >= 6 && cls.hitDie <= 12, `class ${cls.id}: odd hit die ${cls.hitDie}`);
    assert(cls.saves.length === 2, `class ${cls.id}: expected 2 saves`);
    assert(cls.subclassIds.length === 4, `class ${cls.id}: expected 4 subclasses, got ${cls.subclassIds.length}`);
    assert(cls.multiclass?.prereqs?.length, `class ${cls.id}: missing multiclass prereqs`);
  }
  const rogue = out.classes.find((c) => c.id === "rogue");
  for (const scId of ["arcane-trickster", "assassin", "soulknife", "thief"]) {
    assert(rogue.subclassIds.includes(scId), `rogue missing subclass ${scId}`);
  }
  const thirdCasters = out.subclasses.filter((sc) => /eldritch\s*knight|arcane\s*trickster/i.test(sc.name));
  assert(thirdCasters.length === 2, "expected Eldritch Knight + Arcane Trickster subclasses");
  const fireball = out.spells.find((s) => s.id === "fireball");
  assert(fireball?.level === 3 && fireball.roll === "8d6", "fireball spot-check failed");
  assert(fireball.classes.includes("sorcerer") && fireball.classes.includes("wizard"), "fireball classes spot-check failed");
  const longsword = out.equipment.find((e) => e.id === "longsword");
  assert(longsword?.damage === "1d8" && longsword.damageType === "slashing" && longsword.cost === "15 gp", "longsword spot-check failed");
  assert(longsword.properties.some((p) => p.startsWith("Versatile (1d10)")), "longsword versatile spot-check failed");
  assert(longsword.properties.includes("Mastery: Sap"), "longsword mastery spot-check failed");
  const goblinBoss = out.monsters.find((m) => m.id === "goblin-boss");
  assert(goblinBoss?.ac === 17 && goblinBoss.hp === 21 && goblinBoss.cr === "1", "goblin-boss spot-check failed");
  assert(goblinBoss.skills["skill-stealth"] === 6, "goblin-boss stealth spot-check failed");
  const acolyte = out.backgrounds.find((b) => b.id === "acolyte");
  assert(
    acolyte && acolyte.skills.includes("skill-insight") && acolyte.skills.includes("skill-religion"),
    "acolyte background spot-check failed",
  );
  const drow = out.species.find((s) => s.id === "elf")?.subspecies?.find((ss) => ss.id === "elf-drow");
  assert(drow?.traits.some((t) => /Darkvision/i.test(t.name) && /120/.test(t.description)), "drow darkvision spot-check failed");
  const MONSTER_TYPES = new Set([
    "Aberration", "Beast", "Celestial", "Construct", "Dragon", "Elemental", "Fey",
    "Fiend", "Giant", "Humanoid", "Monstrosity", "Ooze", "Plant", "Undead", "Varies",
  ]);
  for (const m of out.monsters) {
    assert(typeof m.hp === "number" && typeof m.ac === "number", `monster ${m.id}: missing hp/ac`);
    assert(MONSTER_TYPES.has(m.type), `monster ${m.id}: unexpected type "${m.type}"`);
    assert(XP_BY_CR[m.cr] !== undefined, `monster ${m.id}: unexpected cr "${m.cr}"`);
  }
  for (const sp of out.spells) {
    assert(sp.level >= 0 && sp.level <= 9, `spell ${sp.id}: bad level`);
    assert(sp.description, `spell ${sp.id}: missing description`);
  }

  // --- write ----------------------------------------------------------------
  await mkdir(OUT_DIR, { recursive: true });
  const counts = {};
  for (const [category, rows] of Object.entries(out)) {
    counts[category] = rows.length;
    await writeFile(path.join(OUT_DIR, `${category}.json`), JSON.stringify(rows, null, 1) + "\n");
  }
  const meta = {
    ruleset: "D&D 5e 2024 (Player's Handbook, Dungeon Master's Guide, Monster Manual)",
    license: "Content © Wizards of the Coast — private-table use only, not for redistribution",
    attribution: "Compendium data from the D&D 2024 core rulebooks (Wizards of the Coast).",
    source: { file: XML_FILE, format: "Fight Club 5 compendium XML v5" },
    counts,
    generated: new Date().toISOString().slice(0, 10),
  };
  await writeFile(path.join(OUT_DIR, "meta.json"), JSON.stringify(meta, null, 1) + "\n");

  // --- summary for eyeballing ----------------------------------------------
  console.log("Wrote", OUT_DIR);
  console.table(counts);
  const distinct = (rows, f) => [...new Set(rows.map(f))].sort();
  console.log("casting times:", distinct(out.spells, (s) => s.time).join(" | "));
  console.log("feat categories:", distinct(out.feats, (f) => f.category).join(" | "));
  console.log("monster types:", distinct(out.monsters, (m) => m.type).join(" | "));
  const noAtk = out.monsters.filter((m) => (m.actions ?? []).length && !(m.actions ?? []).some((a) => a.toHit != null));
  console.log(`monsters with actions but no parsed to-hit: ${noAtk.length}`, noAtk.slice(0, 8).map((m) => m.id).join(", "));
  const biggest = [...out.monsters].sort((a, b) => JSON.stringify(b).length - JSON.stringify(a).length)[0];
  console.log("largest monster entry:", biggest.id, JSON.stringify(biggest).length, "bytes");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
