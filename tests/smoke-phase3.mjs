// Phase 3 WS smoke test: combat start (everyone pending — no NPC auto-roll), DM NPC
// initiative (auto-roll fallback + physical d20 binding with per-entry bonus + zip),
// player CTA + physical d20 roll (only a d20 counts), DEX tiebreak, turn wrap,
// set-initiative turn preservation, HP-display redaction exception, mid-combat joiner.
const ROOM = `smoke3-${Date.now().toString(36)}`;
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
    ws, frames, opened,
    send: (obj) => ws.send(JSON.stringify(obj)),
    next: (pred, timeoutMs = 5000) =>
      new Promise((resolve, reject) => {
        const existing = frames.find(pred);
        if (existing) return resolve(existing);
        const timer = setTimeout(() => reject(new Error(`${label}: timeout`)), timeoutMs);
        waiters.push({ pred, resolve: (m) => { clearTimeout(timer); resolve(m); } });
      }),
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const lastState = (c) => c.frames.filter((m) => m.type === "STATE").at(-1).state;
const mkToken = (id, sceneId, extra = {}) => ({
  id, sceneId, x: 0, y: 0, label: id, color: "#c45c5c", kind: "enemy",
  imageUrl: null, ownerPlayerId: null, sheetId: null, conditions: [], showHp: "none", ...extra,
});
const entryById = (state, id) => state.combat?.entries.find((e) => e.id === id);
// Wait until combat entry `id` has a rolled (non-null) initiative — history-safe: a
// null-combat frame or an unrolled entry never matches.
const initSet = (client, id, t = 5000) =>
  client.next((m) => {
    if (m.type !== "STATE") return false;
    const e = entryById(m.state, id);
    return !!e && e.initiative !== null;
  }, t);

// A physical 3D throw: a minimal but valid track (1 frame → 7 samples/die) passes
// sanitizeThrow. The roller receives DICE_THROW carrying the server-decided faceValues.
let rollSeq = 0;
async function physThrow(client, kinds, context) {
  const rollId = `r${Date.now().toString(36)}-${rollSeq++}`;
  const specs = kinds.map((kind, i) => ({ id: `${rollId}-${i}`, kind, percentile: false }));
  const track = {
    fps: 30, frames: 1,
    dice: specs.map((s) => ({ id: s.id, samples: [0, 0, 0, 0, 0, 0, 1] })),
    impacts: [],
  };
  client.send({
    type: "DICE_THROW_REQUEST", rollId, specs, track, modifier: 0, trayCenter: [0, 0],
    ...(context ? { context } : {}),
  });
  const frame = await client.next((m) => m.type === "DICE_THROW" && m.rollId === rollId);
  return { rollId, faceValues: frame.faceValues };
}

try {
  // Setup: DM, one player slot + player
  const dm = connect("dm");
  await dm.opened;
  dm.send({ type: "JOIN", role: "dm", displayName: "DM", roomKey: "" });
  await dm.next((m) => m.type === "JOINED");
  dm.send({ type: "ADD_PLAYER_SLOT", name: "Vex" });
  const slotFrame = await dm.next((m) => m.type === "STATE" && m.state.playerSlots.length === 1);
  const vexId = slotFrame.state.playerSlots[0].id;
  const sceneId = slotFrame.state.activeSceneId;

  const vex = connect("vex");
  await vex.opened;
  vex.send({ type: "JOIN", role: "player", slotId: vexId, roomKey: "" });
  await vex.next((m) => m.type === "JOINED");

  // NPC sheet with high DEX (18 → +4) and some HP
  dm.send({ type: "CREATE_SHEET", sheetId: "sheet-gob", name: "Goblin" });
  const gobFrame = await dm.next((m) => m.type === "STATE" && m.state.sheets["sheet-gob"]);
  dm.send({
    type: "UPDATE_SHEET", sheetId: "sheet-gob",
    sheet: { ...gobFrame.state.sheets["sheet-gob"].data, abilityScores: { dex: 18 }, hp: { current: 9, max: 21 } },
  });
  await dm.next((m) => m.type === "STATE" && m.state.sheets["sheet-gob"]?.data.hp.max === 21);

  // Tokens: player token + goblin (sheet) + mook (no sheet)
  dm.send({ type: "ADD_TOKEN", token: mkToken("tok-vex", sceneId, { kind: "player", ownerPlayerId: vexId, label: "Vex" }) });
  dm.send({ type: "ADD_TOKEN", token: mkToken("tok-gob", sceneId, { sheetId: "sheet-gob", label: "Goblin" }) });
  dm.send({ type: "ADD_TOKEN", token: mkToken("tok-mook", sceneId, { label: "Mook" }) });
  await dm.next((m) => m.type === "STATE" && m.state.tokens.length === 3);

  const allTokenIds = ["tok-vex", "tok-gob", "tok-mook"];

  // ==== Combat: no auto-roll; DM auto-roll fallback + physical d20; player physical =====
  dm.send({ type: "COMBAT_START", tokenIds: allTokenIds });
  const start = await dm.next(
    (m) => m.type === "STATE" && m.state.combat && m.state.combat.entries.length === 3 &&
      m.state.combat.entries.every((e) => e.initiative === null),
  );
  const idOf = (tokenId) => start.state.combat.entries.find((e) => e.tokenId === tokenId).id;
  const gobEntryId = idOf("tok-gob");
  const mookEntryId = idOf("tok-mook");
  const pcEntryId = idOf("tok-vex");
  check(
    "combat starts: EVERYONE pending (no NPC auto-roll)",
    start.state.combat.round === 1 &&
      start.state.combat.entries.every((e) => e.initiative === null && e.hasRolled === false),
    `inits=[${start.state.combat.entries.map((e) => e.initiative)}]`,
  );
  check(
    "combat start logged",
    start.state.log.some((e) => e.kind === "event" && /Combat started/.test(e.text)),
  );

  // DM auto-roll fallback (3D off) for the mook only: targeted, NPC-only.
  dm.send({ type: "COMBAT_ROLL_INITIATIVE_NPCS", entryIds: [mookEntryId] });
  const mookRolled = await initSet(dm, mookEntryId);
  const gobAfterMook = entryById(mookRolled.state, gobEntryId);
  const pcAfterMook = entryById(mookRolled.state, pcEntryId);
  check(
    "DM 'Roll NPCs' fallback rolls only the targeted NPC; others stay pending",
    entryById(mookRolled.state, mookEntryId).hasRolled &&
      gobAfterMook.initiative === null && pcAfterMook.initiative === null,
    `mook=${entryById(mookRolled.state, mookEntryId).initiative} gob=${gobAfterMook.initiative} pc=${pcAfterMook.initiative}`,
  );
  check(
    "NPC initiative logged under the Initiative label",
    mookRolled.state.log.some((e) => e.kind === "roll" && e.label === "Initiative"),
  );

  // DM FREE-throw from the tray (no explicit target): auto-fills the NEXT unrolled NPC.
  // Throwing 2 d20s with only one NPC left fills it from one die; the extra is ignored.
  const mookBefore = entryById(mookRolled.state, mookEntryId).initiative;
  const dmFree = await physThrow(dm, ["d20", "d20"]);
  const gobBound = await initSet(dm, gobEntryId, 4000);
  const gobB = entryById(gobBound.state, gobEntryId);
  check(
    "DM free d20 throw auto-fills the next NPC (face + own bonus, goblin +4)",
    [dmFree.faceValues[0] + 4, dmFree.faceValues[1] + 4].includes(gobB.initiative) && gobB.hasRolled,
    `faces=[${dmFree.faceValues}] gob=${gobB.initiative}`,
  );
  check(
    "extra dice beyond the unrolled-NPC count are ignored (mook unchanged)",
    entryById(gobBound.state, mookEntryId).initiative === mookBefore,
  );
  check(
    "DM free throw logged under the Initiative label",
    gobBound.state.log.some((e) => e.kind === "roll" && e.label === "Initiative" && /d20/.test(e.roll?.expression ?? "")),
  );
  check("unrolled PC still sorts last", gobBound.state.combat.entries.at(-1).id === pcEntryId);

  // With every NPC rolled, a DM free d20 does NOT touch the pending PC (players roll their own).
  await physThrow(dm, ["d20"]);
  const dmNoop = await dm.next(
    (m) => m.type === "STATE" &&
      m.state.log.some((e) => e.kind === "roll" && e.roll?.expression === "1d20" && e.label !== "Initiative"),
    4000,
  );
  check("DM free d20 with no unrolled NPCs leaves the pending PC alone", entryById(dmNoop.state, pcEntryId).initiative === null);

  // Player throws a NON-d20 while pending → it does NOT count for initiative.
  await physThrow(vex, ["d6"]);
  const afterD6 = await vex.next(
    (m) => m.type === "STATE" && m.state.log.some((e) => e.kind === "roll" && e.roll?.expression === "1d6"),
    4000,
  );
  check("a player's non-d20 throw does NOT set initiative", entryById(afterD6.state, pcEntryId).initiative === null);

  // Player throws a d20 while pending → their own initiative binds.
  const vexThrow = await physThrow(vex, ["d20"]);
  const pcBound = await initSet(vex, pcEntryId, 4000);
  const vexB = entryById(pcBound.state, pcEntryId);
  check(
    "a player's d20 throw sets their own initiative",
    vexB.hasRolled && vexB.initiative !== null && Number.isInteger(vexB.initiative),
    `face=${vexThrow.faceValues[0]} init=${vexB.initiative}`,
  );

  // re-rolling when nothing pending → error
  vex.send({ type: "COMBAT_ROLL_INITIATIVE" });
  const rerollErr = await vex.next((m) => m.type === "ERROR");
  check("no double initiative roll", /no pending/i.test(rerollErr.message));

  // --- DEX tiebreak via forced tie --------------------------------------------------
  const combatNow = lastState(dm).combat;
  for (const entry of combatNow.entries) {
    dm.send({ type: "COMBAT_SET_INITIATIVE", entryId: entry.id, value: 15 });
  }
  await sleep(400);
  const tied = lastState(dm).combat.entries;
  const gobIdx = tied.findIndex((e) => e.tokenId === "tok-gob");
  check(
    "equal initiative ties broken by DEX (goblin DEX 18 first)",
    tied.every((e) => e.initiative === 15) && gobIdx === 0,
    `order=[${tied.map((e) => `${e.name}:${e.dexScore}`)}]`,
  );

  // --- set-initiative preserves whose turn it is ------------------------------------
  const currentEntryId = tied[lastState(dm).combat.turnIndex].id;
  const lastEntry = tied[tied.length - 1];
  dm.send({ type: "COMBAT_SET_INITIATIVE", entryId: lastEntry.id, value: 99 });
  const resorted = await dm.next(
    (m) => m.type === "STATE" && m.state.combat?.entries[0]?.id === lastEntry.id,
  );
  const stillCurrent = resorted.state.combat.entries[resorted.state.combat.turnIndex].id;
  check("re-sort keeps the turn on the same combatant", stillCurrent === currentEntryId);

  // --- turn wrap → round increments -------------------------------------------------
  const entryCount = resorted.state.combat.entries.length;
  for (let i = 0; i < entryCount; i++) {
    dm.send({ type: "COMBAT_NEXT" });
  }
  const wrapped = await dm.next((m) => m.type === "STATE" && m.state.combat?.round === 2);
  check(
    "turn wrap increments round and logs it",
    wrapped.state.combat.turnIndex === wrapped.state.combat.entries.length - 1 ||
      wrapped.state.log.some((e) => e.kind === "event" && /Round 2/.test(e.text)),
  );

  // --- HP redaction exception -------------------------------------------------------
  // Goblin sheet combat section is unrevealed → hp normally stripped for players.
  let vexView = lastState(vex).sheets["sheet-gob"];
  check("baseline: hidden NPC hp stripped for player", vexView.data.hp.max === 0);

  const gobToken = lastState(dm).tokens.find((t) => t.id === "tok-gob");
  dm.send({ type: "UPDATE_TOKEN", token: { ...gobToken, showHp: "bar" } });
  await vex.next(
    (m) => m.type === "STATE" && m.state.tokens.find((t) => t.id === "tok-gob")?.showHp === "bar",
  );
  vexView = lastState(vex).sheets["sheet-gob"];
  check(
    "showHp=bar exposes hp (and only hp) through redaction",
    vexView.data.hp.max === 21 && vexView.data.ac === 0 && vexView.data.characterName === "",
    `hp=${vexView.data.hp.current}/${vexView.data.hp.max} ac=${vexView.data.ac}`,
  );

  // --- conditions roundtrip ---------------------------------------------------------
  dm.send({ type: "UPDATE_TOKEN", token: { ...gobToken, showHp: "bar", conditions: ["poisoned", "prone", "bogus"] } });
  const condFrame = await vex.next(
    (m) => m.type === "STATE" && m.state.tokens.find((t) => t.id === "tok-gob")?.conditions.length > 0,
  );
  const condTok = condFrame.state.tokens.find((t) => t.id === "tok-gob");
  check(
    "conditions sync; unknown ids dropped",
    condTok.conditions.includes("poisoned") && condTok.conditions.includes("prone") &&
      !condTok.conditions.includes("bogus"),
    `[${condTok.conditions}]`,
  );

  // --- mid-combat joiner sees the tracker -------------------------------------------
  dm.send({ type: "ADD_PLAYER_SLOT", name: "Brom" });
  const bromSlot = await dm.next((m) => m.type === "STATE" && m.state.playerSlots.length === 2);
  const bromId = bromSlot.state.playerSlots.find((s) => s.name === "Brom").id;
  const brom = connect("brom");
  await brom.opened;
  brom.send({ type: "JOIN", role: "player", slotId: bromId, roomKey: "" });
  const bromState = await brom.next((m) => m.type === "STATE" && m.yourRole === "player");
  check(
    "mid-combat joiner receives the combat state",
    bromState.state.combat && bromState.state.combat.round >= 2,
  );

  // --- end combat -------------------------------------------------------------------
  dm.send({ type: "COMBAT_END" });
  const ended = await vex.next(
    (m) =>
      m.type === "STATE" &&
      m.state.combat === null &&
      m.state.log.some((e) => e.kind === "event" && /Combat ended/.test(e.text)),
  );
  check("combat ends and is logged", !!ended);

  dm.ws.close();
  vex.ws.close();
  brom.ws.close();
} catch (err) {
  check("smoke run completed", false, String(err));
}

const failed = results.filter((r) => !r.ok);
console.log(failed.length === 0 ? "\nALL CHECKS PASSED" : `\n${failed.length} CHECK(S) FAILED`);
process.exit(failed.length === 0 ? 0 : 1);
