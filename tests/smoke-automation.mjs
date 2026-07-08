// AUTOMATION_PLAN WS smoke test: the rules engine at the WebSocket-frame level.
// Round A: ROLL_CHECK derives dot × prof + overrides server-side. Round B: token
// conditions impose disadvantage. Round C: REST/CAST_SPELL/USE_FEATURE/
// USE_ITEM_CHARGE/DEATH_SAVE/APPLY_DAMAGE mutate the sheet with authz.
const ROOM = `smokeauto-${Date.now().toString(36)}`;
const URL_BASE = `ws://127.0.0.1:1999/parties/main/${ROOM}`;

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

function connect(label) {
  const ws = new WebSocket(URL_BASE);
  const frames = [];
  const waiters = [];
  ws.addEventListener("message", (e) => {
    const msg = JSON.parse(e.data);
    frames.push(msg);
    for (const w of [...waiters]) {
      if (w.pred(msg)) {
        waiters.splice(waiters.indexOf(w), 1);
        w.resolve(msg);
      }
    }
  });
  const opened = new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve);
    ws.addEventListener("error", () => reject(new Error(`${label}: connect failed`)));
  });
  return {
    ws,
    frames,
    opened,
    send: (obj) => ws.send(JSON.stringify(obj)),
    next: (pred, timeoutMs = 4000) =>
      new Promise((resolve, reject) => {
        const existing = frames.find(pred);
        if (existing) return resolve(existing);
        const timer = setTimeout(() => reject(new Error(`${label}: timeout waiting for frame`)), timeoutMs);
        waiters.push({ pred, resolve: (m) => { clearTimeout(timer); resolve(m); } });
      }),
  };
}

try {
  const dm = connect("dm");
  await dm.opened;
  dm.send({ type: "JOIN", role: "dm", displayName: "DM", roomKey: "" });
  await dm.next((m) => m.type === "JOINED");

  dm.send({ type: "ADD_PLAYER_SLOT", name: "Vex" });
  const slotFrame = await dm.next((m) => m.type === "STATE" && m.state.playerSlots.length > 0);
  const slotId = slotFrame.state.playerSlots[0].id;
  const sceneId = slotFrame.state.activeSceneId;

  const player = connect("player");
  await player.opened;
  player.send({ type: "JOIN", role: "player", slotId, roomKey: "" });
  await player.next((m) => m.type === "JOINED");

  // Configure the PC: level 5 (prof +3), DEX 16, CON 14 (+2), proficient Stealth,
  // full caster (WIS), hit dice 3/5 d8, hp 5/30, a short-rest feature, a charged item.
  const base = slotFrame.state.sheets[slotId].data;
  dm.send({
    type: "UPDATE_SHEET",
    sheetId: slotId,
    sheet: {
      ...base,
      level: 5,
      abilityScores: { str: 10, dex: 16, con: 14, int: 10, wis: 12, cha: 10 },
      skillProfs: { "skill-stealth": 1 },
      hp: { current: 5, max: 30 },
      hitDice: { current: 3, max: 5, die: "d8" },
      spellcasting: { abilityId: "wis", attackBonus: 0, saveDc: 0, casterType: "full" },
      features: [
        { id: "feat-1", name: "Second Wind", source: "class", uses: { current: 2, max: 2 }, recovery: "sr", description: "" },
      ],
      inventory: [
        { id: "inv-wand", itemId: null, name: "Wand", qty: 1, note: "", category: "equipment", charges: { current: 2, max: 3 } },
      ],
    },
  });
  await dm.next((m) => m.type === "STATE" && m.state.sheets[slotId]?.data.level === 5);

  // --- Round A: server-side dot × prof + override -----------------------------
  player.send({ type: "ROLL_CHECK", sheetId: slotId, check: { kind: "skill", statId: "skill-stealth" } });
  const skillFrame = await dm.next((m) => m.type === "STATE" && m.state.log.some((e) => e.kind === "roll" && e.label?.startsWith("Stealth check")));
  const skillEntry = [...skillFrame.state.log].reverse().find((e) => e.kind === "roll" && e.label?.startsWith("Stealth check"));
  const profPart = skillEntry.roll.parts?.find((p) => p.kind === "prof");
  check("ROLL_CHECK derives dot × prof server-side (+3)", profPart?.value === 3, JSON.stringify(skillEntry.roll.parts));
  const partsSum = (skillEntry.roll.parts ?? []).reduce((s, p) => s + p.value, 0);
  check("engine parts sum to total", partsSum === skillEntry.roll.total);

  const withOverride = skillFrame.state.sheets[slotId].data;
  dm.send({ type: "UPDATE_SHEET", sheetId: slotId, sheet: { ...withOverride, overrides: { "skill-stealth": 9 } } });
  await dm.next((m) => m.type === "STATE" && m.state.sheets[slotId]?.data.overrides["skill-stealth"] === 9);
  player.send({ type: "ROLL_CHECK", sheetId: slotId, check: { kind: "skill", statId: "skill-stealth" } });
  const ovrFrame = await dm.next((m) => m.type === "STATE" && m.state.log.some((e) => e.kind === "roll" && e.roll.parts?.some((p) => p.label === "Override")));
  const ovrEntry = [...ovrFrame.state.log].reverse().find((e) => e.kind === "roll" && e.roll.parts?.some((p) => p.label === "Override"));
  check("override rolls as one flat part (+9)", ovrEntry.roll.parts.length === 2 && ovrEntry.roll.modifier === 9, JSON.stringify(ovrEntry.roll.parts));

  // --- Round B: the acting token's conditions impose disadvantage -------------
  dm.send({
    type: "ADD_TOKEN",
    token: { id: "tok-vex", sceneId, x: 1, y: 1, color: "#fff", label: "V", ownerPlayerId: slotId, sheetId: null, itemId: null, conditions: ["poisoned"], showHp: "none" },
  });
  await dm.next((m) => m.type === "STATE" && m.state.tokens.some((t) => t.id === "tok-vex"));
  player.send({ type: "ROLL_CHECK", sheetId: slotId, check: { kind: "ability", abilityId: "dex" } });
  const disFrame = await dm.next((m) => m.type === "STATE" && m.state.log.some((e) => e.kind === "roll" && e.label?.includes("dis: poisoned")));
  const disEntry = [...disFrame.state.log].reverse().find((e) => e.kind === "roll" && e.label?.includes("dis: poisoned"));
  check("poisoned token → check rolled at disadvantage", disEntry.roll.adv === "dis", disEntry.label);

  // --- Round C: CAST_SPELL (auto slots: absent = full) -------------------------
  player.send({ type: "CAST_SPELL", sheetId: slotId, level: 1 });
  const cast1 = await dm.next((m) => m.type === "STATE" && m.state.sheets[slotId]?.data.spellSlots["1"]?.current === 3);
  check("CAST_SPELL spends one of the derived slots (4 → 3)", cast1.state.sheets[slotId].data.spellSlots["1"].current === 3);
  for (const left of [2, 1, 0]) {
    player.send({ type: "CAST_SPELL", sheetId: slotId, level: 1 });
    await dm.next((m) => m.type === "STATE" && m.state.sheets[slotId]?.data.spellSlots["1"]?.current === left);
  }
  player.send({ type: "CAST_SPELL", sheetId: slotId, level: 1 });
  const castErr = await player.next((m) => m.type === "ERROR" && /no level-1/i.test(m.message));
  check("CAST_SPELL at 0 slots rejected", !!castErr, castErr?.message);
  player.send({ type: "CAST_SPELL", sheetId: "nonexistent", level: 1 });
  const castAuthzErr = await player.next((m) => m.type === "ERROR" && /not found|own sheet/i.test(m.message));
  check("CAST_SPELL foreign/missing sheet rejected", !!castAuthzErr);

  // --- Round C: USE_FEATURE / USE_ITEM_CHARGE ---------------------------------
  player.send({ type: "USE_FEATURE", sheetId: slotId, featureId: "feat-1" });
  const used = await dm.next((m) => m.type === "STATE" && m.state.sheets[slotId]?.data.features[0]?.uses.current === 1);
  check("USE_FEATURE decrements uses (2 → 1)", used.state.sheets[slotId].data.features[0].uses.current === 1);
  player.send({ type: "USE_ITEM_CHARGE", sheetId: slotId, rowId: "inv-wand" });
  const charged = await dm.next((m) => m.type === "STATE" && m.state.sheets[slotId]?.data.inventory[0]?.charges.current === 1);
  check("USE_ITEM_CHARGE decrements charges (2 → 1)", charged.state.sheets[slotId].data.inventory[0].charges.current === 1);

  // --- Round C: short rest — spend hit dice, recharge "sr" features ------------
  player.send({ type: "REST", sheetId: slotId, kind: "short", spendHitDice: 2 });
  const shortRest = await dm.next((m) => m.type === "STATE" && m.state.sheets[slotId]?.data.hitDice.current === 1);
  const afterShort = shortRest.state.sheets[slotId].data;
  // 2 × d8 + CON(+2) each: heal between 6 and 20 from hp 5.
  check("short rest spends hit dice (3 → 1)", afterShort.hitDice.current === 1);
  check("short rest heals die + CON each", afterShort.hp.current >= 11 && afterShort.hp.current <= 25, `hp=${afterShort.hp.current}`);
  check("short rest recharges sr features", afterShort.features[0].uses.current === 2);
  check("short rest logs a summary", shortRest.state.log.some((e) => e.kind === "event" && /short rest/i.test(e.text)));

  // --- Round C: long rest — full HP, half hit dice, all slots, saves reset -----
  dm.send({ type: "UPDATE_SHEET", sheetId: slotId, sheet: { ...afterShort, deathSaves: { successes: 1, failures: 2 } } });
  await dm.next((m) => m.type === "STATE" && m.state.sheets[slotId]?.data.deathSaves.failures === 2);
  player.send({ type: "REST", sheetId: slotId, kind: "long" });
  const longRest = await dm.next((m) => m.type === "STATE" && m.state.sheets[slotId]?.data.hp.current === 30);
  const afterLong = longRest.state.sheets[slotId].data;
  check("long rest: HP to max", afterLong.hp.current === 30);
  check("long rest: regains half hit dice (1 → 3, max 5 from level)", afterLong.hitDice.current === 3, `hd=${afterLong.hitDice.current}`);
  check("long rest: all spell slots back (0 → 4)", afterLong.spellSlots["1"]?.current === 4, JSON.stringify(afterLong.spellSlots["1"]));
  check("long rest: death saves reset", afterLong.deathSaves.successes === 0 && afterLong.deathSaves.failures === 0);

  // --- Round C: DEATH_SAVE (server-rolled) --------------------------------------
  dm.send({ type: "UPDATE_SHEET", sheetId: slotId, sheet: { ...afterLong, hp: { current: 0, max: 30 } } });
  await dm.next((m) => m.type === "STATE" && m.state.sheets[slotId]?.data.hp.current === 0);
  player.send({ type: "DEATH_SAVE", sheetId: slotId });
  const dsFrame = await dm.next((m) => m.type === "STATE" && m.state.log.some((e) => e.kind === "roll" && e.label?.startsWith("Death saving throw")));
  const dsData = dsFrame.state.sheets[slotId].data;
  const dsMoved = dsData.deathSaves.successes + dsData.deathSaves.failures > 0 || dsData.hp.current === 1;
  check("DEATH_SAVE rolls server-side and marks the tracker (or nat 20 → 1 HP)", dsMoved, JSON.stringify(dsData.deathSaves));

  // --- Round C: APPLY_DAMAGE respects resistance pills, DM-only -----------------
  dm.send({ type: "CREATE_SHEET", sheetId: "sheet-npc", name: "Ember" });
  const npcFrame = await dm.next((m) => m.type === "STATE" && m.state.sheets["sheet-npc"]);
  dm.send({
    type: "UPDATE_SHEET",
    sheetId: "sheet-npc",
    sheet: { ...npcFrame.state.sheets["sheet-npc"].data, hp: { current: 20, max: 20 }, resistances: ["fire"], immunities: ["poison"] },
  });
  await dm.next((m) => m.type === "STATE" && m.state.sheets["sheet-npc"]?.data.hp.current === 20);
  dm.send({ type: "APPLY_DAMAGE", sheetId: "sheet-npc", amount: 15, damageType: "fire" });
  const resisted = await dm.next((m) => m.type === "STATE" && m.state.sheets["sheet-npc"]?.data.hp.current === 13);
  check("APPLY_DAMAGE halves resisted damage (15 fire → 7)", resisted.state.sheets["sheet-npc"].data.hp.current === 13);
  dm.send({ type: "APPLY_DAMAGE", sheetId: "sheet-npc", amount: 10, damageType: "poison" });
  const immuneLog = await dm.next((m) => m.type === "STATE" && m.state.log.some((e) => e.kind === "event" && /immune/i.test(e.text)));
  check("APPLY_DAMAGE zeroes immune damage (log notes immune)", immuneLog.state.sheets["sheet-npc"].data.hp.current === 13);
  player.send({ type: "APPLY_DAMAGE", sheetId: "sheet-npc", amount: 5 });
  const dmOnlyErr = await player.next((m) => m.type === "ERROR" && /only the dm/i.test(m.message));
  check("APPLY_DAMAGE is DM-only", !!dmOnlyErr);

  const failures = results.filter((r) => !r.ok).length;
  console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
} catch (error) {
  console.error("FATAL:", error.message ?? error);
  process.exit(1);
}
